import dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const Config = {
	PORT: process.env.PORT,
};

export default Config;
