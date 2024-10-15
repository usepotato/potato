import express from 'express';
import serverRouter from '@potato/server';
import getLogger from '@lib/logging';
import Config from '@lib/config';

const logger = getLogger('index');

const app = express();

app.use('/', serverRouter);

const port = Config.PORT;
app.listen(port, () => {
	logger.log(`Listening on port ${port}...`);
});
