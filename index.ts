import express from 'express';
import { Server } from 'socket.io';
import serverRouter, { setupSocket } from '@potato/server';
import getLogger from '@lib/logging';
import Config from '@lib/config';
import http from 'http';
import { getBaseUrl } from '@lib/util';
import redis from '@lib/redis';

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

app.use('/', serverRouter);

setupSocket(io);

// const workerId = uuidv4();
let WORKER_ID: string;
let BASE_URL: string;

const setAvailable = async () => {
	await redis.sadd('browser:available', WORKER_ID);
	await redis.set(`browser:${WORKER_ID}`, JSON.stringify({ base_url: BASE_URL, state: 'available' }));

	logger.log(`Worker ${WORKER_ID} is available at ${BASE_URL}`);
};

const setOffline = async () => {
	await redis.del(`browser:${WORKER_ID}`);
	await redis.srem('browser:available', WORKER_ID);
	logger.log(`Worker ${WORKER_ID} is offline`);
};

const port = Config.PORT;

app.listen(port, async () => {
	logger.log(`Listening on port ${port}...`);
	BASE_URL = await getBaseUrl();
	WORKER_ID = BASE_URL.replaceAll('/', '').replaceAll(':', '_');
	await setAvailable();
});

async function handleShutdown() {
	logger.log('Shutting down...');
	await setOffline();
	await redis.quit();
	process.exit(0);
}


// handle shutdown
['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach((signal) => {
	process.on(signal, handleShutdown);
});
