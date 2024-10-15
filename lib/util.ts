import axios from 'axios';
import Config from './config';

export const getBaseUrl = async () => {
	// ping to get AWS hostname
	try {
		await axios.get('http://169.254.169.254/latest/meta-data/hostname', {
			timeout: 1000,
		});
	} catch (_) {
		return `http://localhost:${Config.PORT}`;
	}
};
