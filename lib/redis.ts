import Redis from 'ioredis';
import Config from './config';

const redis = new Redis(Config.REDIS_URL);

export default redis;
