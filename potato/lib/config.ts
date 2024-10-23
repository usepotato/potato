import dotenv from 'dotenv';
import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

dotenv.config({ path: '.env' });
dotenv.config({ path: '../.env' });

const client = new SecretsManagerClient({
	region: 'us-west-1',
});

const response = await client.send(
	new GetSecretValueCommand({
		SecretId: 'prod/potato',
		VersionStage: 'AWSCURRENT',
	})
);

const secrets = JSON.parse(response.SecretString || '{}');

interface ConfigType {
	PORT: number;
	REDIS_URL: string;
	OPENAI_API_KEY: string;
}

function getConfig(): ConfigType {
	let config;
	if (process.env.NODE_ENV === 'production') {
		config = {
			PORT: secrets.PORT || 80,
			REDIS_URL: secrets.REDIS_URL,
			OPENAI_API_KEY: secrets.OPENAI_API_KEY,
		};
	} else {
		config = {
			PORT: Number(process.env.PORT) || 25565,
			REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
			OPENAI_API_KEY: process.env.OPENAI_API_KEY,
		};
	}

	if (!config.OPENAI_API_KEY) {
		throw new Error('OPENAI_API_KEY is not set');
	}

	return config as ConfigType;
}


const Config = getConfig();

export default Config;

