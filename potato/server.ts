import express from 'express';

const serverRouter = express.Router();

serverRouter.get('/', (req, res) => {
	res.send('Hello World!');
});

export default serverRouter;
