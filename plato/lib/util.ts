import axios from 'axios';
import Config from './config';

export const getBaseUrl = async () => {
	// ping to get AWS hostname
	try {
		const res = await axios.get('http://169.254.169.254/latest/meta-data/hostname', {
			timeout: 1000,
		});
		return `http://${res.data}`;
	} catch (_) {
		return `http://0.0.0.0:${Config.PORT}`;
	}
};
