import axios from 'axios';

export async function getBrowserData() {
	const { data } = await axios.get('http://localhost:9222/json/version');
	return data;
}
