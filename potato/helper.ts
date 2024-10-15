import axios from 'axios';

export async function getBrowserData() {
	const { data } = await axios.get('http://127.0.0.1:9222/json/version');
	return data;
}
