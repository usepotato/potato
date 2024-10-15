import redis from '@lib/redis';
import { getBrowserData } from './helper';
import getLogger from '@lib/logging';
import puppeteer, { Browser, Frame, HTTPResponse, Target, TargetType } from 'puppeteer';
import browserPageScripts from './browserPageScripts.js';
import type { Server } from 'socket.io';

const logger = getLogger('potato');

interface BrowserUpdate {
	type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
}

class Potato {
	workerId: string;
	baseUrl: string;
	browser: Browser | null;
	sessionId: string | null;
	requestCache: Record<string, [Buffer, string]>;
	io: Server;
	subscribers: Set<string>;
	constructor(io: Server, workerId: string, baseUrl: string) {
		this.io = io;
		this.workerId = workerId;
		this.baseUrl = baseUrl;
		this.browser = null;
		this.sessionId = null;
		this.requestCache = {};
		this.subscribers = new Set<string>();
	}

	async _setAvailable() {
		logger.info(`Setting browser ${this.workerId} as AVAILABLE`);
		await redis.sadd('browser:available', this.workerId);
		await redis.set(`browser:${this.workerId}`, JSON.stringify({ baseUrl: this.baseUrl, state: 'available' }));
	}

	async _setBusy() {
		logger.info(`Setting browser ${this.workerId} as BUSY`);
		await redis.srem('browser:available', this.workerId);
		await redis.set(`browser:${this.workerId}`, JSON.stringify({ baseUrl: this.baseUrl, state: 'busy' }));
	}

	async _setOffline() {
		logger.info(`Setting browser ${this.workerId} as OFFLINE`);
		await redis.del(`browser:${this.workerId}`);
		await redis.srem('browser:available', this.workerId);
	}

	async _getPage() {
		if (!this.browser) { return null; }
		const pages = await this.browser.pages();
		if (pages.length) return pages[0];

		const page = await this.browser.newPage();
		return page;
	}

	async close() {
		await this._setOffline();
		await this.browser?.disconnect();
	}

	async launch() {
		try {
			const browserData = await getBrowserData();
			const webSocketUrl = browserData.webSocketDebuggerUrl;
			logger.info('browserData', JSON.stringify(browserData));
			this.browser = await puppeteer.connect({ browserWSEndpoint: webSocketUrl });

			const onShinpadsUpdate = (msg: any) => {
				try {
					const data = JSON.parse(msg);
					this.publishUpdate(data);
				} catch (error) {
					logger.error('Error processing update', error);
				}
			};

			const onResponse = async (response: HTTPResponse) => {
				try {
					const content = await response.buffer();
					const contentType = response.headers()['content-type'];
					this.requestCache[response.url()] = [content, contentType];
				} catch (error) {
					logger.error('Error caching response', response.url());
				}

			};


			const onTargetCreated = async (target: Target) => {
				if (target.type() === TargetType.PAGE) {
					const page = await target.page();
					if (!page) return;
					const onFrameNavigated = async (frame: Frame) => {
						if (page.mainFrame() === frame) {
							await this.publishUpdate({ type: 'loading', data: { 'loading': true } });
							await page.waitForSelector('body');
							try {
								await page.exposeFunction('shinpadsUpdate', onShinpadsUpdate);
							} catch (_) { /* ignore */ }

							await page.evaluate(`window.browserSessionId = "${this.sessionId}"`);
							logger.info('Evaluating browserPageScripts', browserPageScripts);
							await page.evaluate(browserPageScripts);
						}
					};

					page.on('response', onResponse);
					page.on('framenavigated', onFrameNavigated);
				}
			};

			const onBrowserDisconnected = () => {
				console.log('onBrowserDisconnected');
			};

			this.browser.on('disconnected', onBrowserDisconnected);
			this.browser.on('targetcreated', onTargetCreated);

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
		logger.info('new page', JSON.stringify(page));
		await page.goto('https://google.com');

		return {
			sessionId,
			baseUrl: this.baseUrl,
			timestamp: Date.now(),
		};
	}

	async processUpdate(update: BrowserUpdate) {
		if (!this.browser) {
			logger.error('Browser not connected');
			return;
		}

		try {
			const page = await this._getPage();
			if (!page) { throw new Error('Failed to get page'); }

			if (update.type === 'resize') {
				await page.setViewport(update.data);
			} else if (update.type === 'click') {
				await page.click(`[shinpads-id="${update.data.shinpadsId}"]`);
				logger.info(`Clicked on ${update.data.x}, ${update.data.y}`);
			} else if (update.type === 'scroll') {
				await page.evaluate(`window.scrollTo(${update.data.x}, ${update.data.y})`);
			} else if (update.type === 'reload') {
				await page.reload();
			} else if (update.type === 'navigate') {
				await page.goto(update.data);
			} else if (update.type === 'go-back') {
				await page.goBack();
			} else if (update.type === 'go-forward') {
				await page.goForward();
			} else if (update.type === 'mousemove') {
				await page.mouse.move(update.data.x, update.data.y);
			} else if (update.type === 'input') {
				await page.evaluate(`
          const element = document.querySelector('[shinpads-id="${update.data.shinpadsId}"]');
          element.value = "${update.data.value}";
          element.dispatchEvent(new Event('input', { bubbles: true }));
        `);
			} else if (update.type === 'keydown') {
				await page.keyboard.press(update.data.key);
			} else {
				logger.error(`Unknown update type: ${update.type}`);
			}
		} catch (error) {
			logger.error('Failed to process update', error);
		}
	}

	async sendPageContent() {
		const page = await this._getPage();
		if (!page) { return; }
		await page.waitForSelector('body');
		// @ts-ignore
		await page.evaluate(() => window.sendPageContent());
	}

	async publishUpdate(update: BrowserUpdate) {
		for (const subscriber of this.subscribers) {
			this.io.to(subscriber).emit('browser-update', update);
		}
	}

	async addSubscriber(socketId: string) {
		this.subscribers.add(socketId);
		await this.sendPageContent();
	}

	async removeSubscriber(socketId: string) {
		this.subscribers.delete(socketId);
		if (this.subscribers.size === 0) {
			await this._setAvailable();
		}
	}

	async getStaticResource(path: string) {
		const page = await this._getPage();
		if (!page) { return null; }

		if (path.startsWith('/')) {
			path = `${page.url()}${path}`;
		}

		if (!path.startsWith('http')) {
			if (!path.startsWith('/')) {
				path = `/${path}`;
			}
			const originUrl = page.url().split('/').slice(0, 3).join('/');
			path = `${originUrl}${path}`;
		}

		if (this.requestCache[path]) {
			const [content, contentType] = this.requestCache[path];
			if (content.length > 0) {
				return { buffer: content, contentType };
			}
		}

		//@ts-ignore
		const dataUrl = await page.evaluate((path) => window.getBase64FromUrl(path), path);
		if (!dataUrl) { return null; }
		const contentType = dataUrl.split(':')[1].split(';')[0];
		const content = dataUrl.split(',')[1];
		const contentBytes = Buffer.from(content, 'base64');

		this.requestCache[path] = [contentBytes, contentType];
		return { buffer: contentBytes, contentType };
	}


}


export default Potato;
