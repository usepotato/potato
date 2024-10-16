import Redis from 'ioredis';
import Config from './config';

const redis = new Redis(Config.REDIS_URL);

redis.on('error', (error) => {
	console.error(error);
});

export default redis;
