import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const Config = {
	PORT: process.env.PORT || 25565,
	REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
};

export default Config;
