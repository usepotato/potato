import Redis from 'ioredis';
import Config from './config';

import getLogger from './logging';

const logger = getLogger('redis');

const redis = new Redis(Config.REDIS_URL, {
	connectTimeout: 2000,
	retryStrategy(times) {
		if (times >= 3) {
			return null;
		}
		return Math.min(times * 50, 2000);
	},
});

redis.on('error', (error) => {
	logger.error('Redis error:', error);
});

export default redis;
