import express from 'express';
import { Server, Socket } from 'socket.io';
import getLogger from '@lib/logging';
import Config from '@lib/config';
import http from 'http';
import { getBaseUrl } from '@lib/util';
import redis from '@lib/redis';
import Plato from './plato';
import cors from 'cors';
import path from 'path';
import WebSocket from 'ws';

const logger = getLogger('index');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/puppeteer' });


const io = new Server(server, {
	cors: {
		origin: '*',
		methods: ['GET', 'POST'],
		allowedHeaders: ['*'],
	},
	transports: ['websocket', 'polling'],
});


const launchPromise = (async () => {
	const baseUrl = await getBaseUrl();
	const workerId = baseUrl.replaceAll('/', '').replaceAll(':', '_');
	app.locals.plato = new Plato(io, workerId, baseUrl);
	await app.locals.plato.launch();
	logger.info('Plato launched');
})();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
	origin: '*',
	methods: ['GET', 'POST'],
	allowedHeaders: ['*'],
	credentials: true,
}));

app.all('*', async (req, res, next) => {
	await launchPromise;
	next();
});

app.use('/plato', express.static(path.join(__dirname, '../dist/plato')));

app.get('/plato', (req, res) => {
	res.sendFile(path.resolve(__dirname, '../dist/plato/index.html'));
});

app.get('/plato/session/:id/status', async (req, res) => {
	const { id } = req.params;
	const plato = await app.locals.plato;
	const active = plato.browser && plato.sessionId === id;
	res.send({ active });
});

app.get('/health', (req, res) => {
	res.send('OK');
});

app.get('/*', async (req, res) => {
	try {
		// @ts-ignore
		const path = req.params[0] as string;
		const queryString = req.originalUrl.includes('?') ? '?' + req.originalUrl.split('?')[1] : '';
		const { buffer, contentType } = await app.locals.plato.getStaticResource(path + queryString);
		res.set('Content-Type', contentType);
		res.send(buffer);
	} catch (error) {
		res.status(500).send('Internal server error');
	}
});

app.post('/start-session', async (req, res) => {
	const { browserSessionId } = req.body;
	logger.log(`Starting session for browser session ${browserSessionId}`);

	const response = await app.locals.plato.startSession(browserSessionId);

	res.send(response);
});

app.post('/run-web-action', async (req, res) => {
	const { browserSessionId, action } = req.body;
	const response = await app.locals.plato.runWebAction(browserSessionId, action);

	res.send({ data: response });
});


io.on('connection', async (socket: Socket) => {
	logger.info(`New connection: ${socket.id}`);
	await launchPromise;

	await app.locals.plato.addSubscriber(socket.id);

	socket.emit('test', 'test');

	socket.on('connect_error', async (error) => {
		logger.error(`Connection error: ${error}`);
		await app.locals.plato.addSubscriber(socket.id);
	});

	socket.on('disconnect', async () => {
		logger.info(`Disconnected: ${socket.id}`);
		await app.locals.plato.removeSubscriber(socket.id);
	});

	socket.on('ping', async (start_t: number) => {
		socket.emit('pong', start_t);
	});

	socket.on('browser-update', async (data) => {
		await app.locals.plato.processUpdate(data);
	});
});

io.on('connect_error', (error) => {
	logger.error(`Connection error: ${error}`);
});

io.on('error', (error) => {
	logger.error(`Socket error: ${error}`);
});

io.on('disconnect', () => {
	logger.info('Disconnected!!!');
});

wss.on('connection', async (ws: WebSocket) => {
	await launchPromise;

	app.locals.plato.proxySocket.on('message', (message: string) => {
		ws.send(message);
	});

	app.locals.plato.proxySocket.on('error', (error) => {
		logger.error(`Puppeteer connection error: ${error}`);
	});

	app.locals.plato.proxySocket.on('close', () => {
		ws.close();
	});

	app.locals.plato.proxySocket.on('disconnected', () => {
		ws.close();
	});

	ws.on('error', (error) => {
		logger.error(`Puppeteer WS connection error: ${error}`);
	});

	ws.on('message', async (message: string) => {
		const { id, method, params } = JSON.parse(message);
		app.locals.plato.proxySocket.send(JSON.stringify({ id, method, params }));
	});

	ws.on('close', () => {
		logger.info('Puppeteer WS connection closed');
	});


});


const port = Config.PORT;

server.listen(port, async () => {
	logger.log(`Listening on port ${port}...`);

	['SIGINT', 'SIGUSR1', 'SIGUSR2', 'SIGTERM'].forEach((signalType) => {
		process.on(signalType, handleShutdown.bind(null));
	});

	// listen for any uncaught errors
	process.on('uncaughtException', (error) => {
		logger.error(`Uncaught exception: ${error}`);
	});
});

async function handleShutdown() {
	logger.log('Shutting down...');
	await app.locals.plato.close();
	await redis.quit();
	process.exit(0);
}


