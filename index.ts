import express from 'express';
import serverRouter from './potato/server.ts';
import getLogger from './lib/logging';

const logger = getLogger('index');

const app = express();

app.use('/', serverRouter);

const port = 25565;
app.listen(port, () => {
	logger.log(`Listening on port ${port}...`);
});
