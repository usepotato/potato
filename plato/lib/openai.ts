import OpenAI from 'openai';
import Config from './config';

const openai = new OpenAI({
	apiKey: Config.OPENAI_API_KEY,
});

export default openai;
