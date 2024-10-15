import express from 'express';
const serverRouter = express.Router();
import { Server } from 'socket.io';
import getLogger from '@lib/logging';

const logger = getLogger('server');

serverRouter.get('/', (req, res) => {
	res.send('Hello World!');
});

serverRouter.post('/start-session', async (req, res) => {
	const { browserSessionId } = req.body;
	logger.log(`Starting session for browser session ${browserSessionId}`);

	res.send({ success: true });
});

export const setupSocket = (io: Server) => {
	io.on('connection', (socket) => {
		console.log('a user connected');
	});
};

export default serverRouter;
