import redis from '@lib/redis';
import { getBrowserData } from './helper';
import getLogger from '@lib/logging';
import util from 'util';
import puppeteer, { Browser } from 'puppeteer';

const logger = getLogger('potato');

class Potato {
	workerId: string;
	baseUrl: string;
	browser: Browser | null;
	sessionId: string | null;

	constructor(workerId: string, baseUrl: string) {
		this.workerId = workerId;
		this.baseUrl = baseUrl;
		this.browser = null;
		this.sessionId = null;
	}

	async _setAvailable() {
		logger.info(`Setting browser ${this.workerId} as AVAILABLE`);
		await redis.sadd('browser:available', this.workerId);
		await redis.set(`browser:${this.workerId}`, JSON.stringify({ base_url: this.baseUrl, state: 'available' }));
	}

	async _setBusy() {
		logger.info(`Setting browser ${this.workerId} as BUSY`);
		await redis.srem('browser:available', this.workerId);
		await redis.set(`browser:${this.workerId}`, JSON.stringify({ base_url: this.baseUrl, state: 'busy' }));
	}

	async _setOffline() {
		logger.info(`Setting browser ${this.workerId} as OFFLINE`);
		await redis.del(`browser:${this.workerId}`);
		await redis.srem('browser:available', this.workerId);
	}

	async launch() {
		try {
			const browserData = await getBrowserData();
			const webSocketUrl = browserData.webSocketDebuggerUrl;
			this.browser = await puppeteer.connect({ browserWSEndpoint: webSocketUrl });

			const pages = await this.browser.pages();
			pages.forEach((page) => {
				page.close();
			});

			const page = await this.browser.newPage();
			await page.goto('https://google.com');

			await this._setAvailable();

			logger.info(`Browser connected on ${webSocketUrl}`);
		} catch (error) {
			logger.error('Failed to launch browser', error);
		}
	}

	async startSession(sessionId: string) {
		if (!this.browser) {
			logger.error('Browser not connected');
			return { success: false, message: 'Browser not connected' };
		}

		await this._setBusy();
		this.sessionId = sessionId;
		logger.info(`Starting session for browser session ${sessionId}`);

		const pages = await this.browser.pages();
		pages.forEach((page) => {
			page.close();
		});

		const page = await this.browser.newPage();
		await page.goto('https://google.com');

		return {
			sessionId,
			baseUrl: this.baseUrl,
			timestamp: Date.now(),
		};
	}
}


export default Potato;
