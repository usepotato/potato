import dotenv from 'dotenv';
import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

dotenv.config({ path: '.env' });

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
}

const DevConfig: ConfigType = {
	PORT: Number(process.env.PORT) || 25565,
	REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
};

const ProdConfig: ConfigType = {
	PORT: Number(process.env.PORT) || 25565,
	REDIS_URL: secrets.REDIS_URL,
};


const Config = process.env.NODE_ENV === 'production' ? ProdConfig : DevConfig;

export default Config;

