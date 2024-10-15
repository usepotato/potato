import express from 'express';
import { Server } from 'socket.io';
import getLogger from '@lib/logging';
import Config from '@lib/config';
import http from 'http';
import { getBaseUrl } from '@lib/util';
import redis from '@lib/redis';
import Potato from '@potato/potato';

const logger = getLogger('index');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
	cors: {
		origin: '*',
	},
	transports: ['websocket'],
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


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


io.on('connection', (socket) => {
	logger.info(`New connection: ${socket.id}`);
});

io.on('disconnect', (socket) => {
	logger.info(`Disconnected: ${socket.id}`);
});

const port = Config.PORT;

app.listen(port, async () => {
	logger.log(`Listening on port ${port}...`);

	const baseUrl = await getBaseUrl();
	const workerId = baseUrl.replaceAll('/', '').replaceAll(':', '_');

	app.locals.potato = new Potato(workerId, baseUrl);
	await app.locals.potato.launch();
});

async function handleShutdown() {
	logger.log('Shutting down...');
	await app.locals.potato.close();
	await redis.quit();
	process.exit(0);
}


// handle shutdown
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) => {
	process.on(signal, handleShutdown);
});
