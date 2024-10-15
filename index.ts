import express from 'express';
import { Server, Socket } from 'socket.io';
import getLogger from '@lib/logging';
import Config from '@lib/config';
import http from 'http';
import { getBaseUrl } from '@lib/util';
import redis from '@lib/redis';
import Potato from '@potato/potato';
import cors from 'cors';

const logger = getLogger('index');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: '*',
		methods: ['GET', 'POST'],
		allowedHeaders: ['*'],
	},
	transports: ['websocket', 'polling'],
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
	origin: '*',
	methods: ['GET', 'POST'],
	allowedHeaders: ['*'],
	credentials: true,
}));

app.get('/', (req, res) => {
	res.send('Hello World!');
});
app.get('/health', (req, res) => {
	res.send('OK');
});

app.post('/start-session', async (req, res) => {
	const { browserSessionId } = req.body;
	logger.log(`Starting session for browser session ${browserSessionId}`);

	const response = await app.locals.potato.startSession(browserSessionId);

	res.send(response);
});


io.on('connection', async (socket: Socket) => {
	logger.info(`New connection: ${socket.id}`);

	socket.emit('test', 'test');

	socket.on('connect_error', (error) => {
		logger.error(`Connection error: ${error}`);
	});

	socket.on('disconnect', async () => {
		logger.info(`Disconnected: ${socket.id}`);
		await app.locals.potato.removeSubscriber(socket.id);
	});

	socket.on('ping', async (start_t: number) => {
		socket.emit('pong', start_t);
	});

	socket.on('browser-update', async (data) => {
		// await io.emit('browser-update', data, socket.id);
		// logger.info(`Browser update: ${data}`);
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


const port = Config.PORT;

server.listen(port, async () => {
	logger.log(`Listening on port ${port}...`);

	const baseUrl = await getBaseUrl();
	const workerId = baseUrl.replaceAll('/', '').replaceAll(':', '_');

	app.locals.potato = new Potato(workerId, baseUrl);
	await app.locals.potato.launch();

	['SIGINT', 'SIGUSR1', 'SIGUSR2', 'SIGTERM'].forEach((signalType) => {
		process.on(signalType, handleShutdown.bind(null));
	});
});

async function handleShutdown() {
	logger.log('Shutting down...');
	await app.locals.potato.close();
	await redis.quit();
	process.exit(0);
}


