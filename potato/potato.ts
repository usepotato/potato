import redis from '@lib/redis.js';
import { getBrowserData } from './helper';
import getLogger from '@lib/logging.js';
import puppeteer, { Browser, Frame, HTTPResponse, Page, Target, TargetType } from 'puppeteer';
import browserPageScripts from './browserPageScripts.js';
import type { Server } from 'socket.io';
import WebSocket from 'ws';
import { injectScript } from './util';

const logger = getLogger('potato');

interface BrowserUpdate {
	type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
}

interface WebAction {
	id: string;
	type: string;
	url?: string;
	parameter: Record<string, string>;
	element: Record<string, string>;
	subActions: WebAction[];
	attribute: string | null;
	filters: Record<string, string>[];
}

const DISCONNECT_TIMEOUT = 1000 * 30; // 30 seconds

class Potato {
	workerId: string;
	baseUrl: string;
	browser: Browser | null;
	sessionId: string | null;
	requestCache: Record<string, [Buffer, string]>;
	io: Server;
	subscribers: Set<string>;
	browserWsUrl?: string;
	proxySocket: WebSocket | null;
	connected: boolean;
	isShuttingDown: boolean;
	hasBeenConnected: boolean;
	lastConnectedAt: number | null;

	constructor(io: Server, workerId: string, baseUrl: string) {
		this.io = io;
		this.workerId = workerId;
		this.baseUrl = baseUrl;
		this.browser = null;
		this.sessionId = null;
		this.requestCache = {};
		this.subscribers = new Set<string>();
		this.proxySocket = null;
		this.connected = false;
		this.isShuttingDown = false;
		this.hasBeenConnected = false;
		this.lastConnectedAt = null;

		this._checkStateLoop();
	}

	async _checkStateLoop() {
		// check every 1s
		setInterval(async () => {
			if (!this.isShuttingDown && !this.connected && this.hasBeenConnected) {
				logger.info('Browser not connected, launching...');
				await this.launch();
			} else if (this.sessionId && !this.subscribers.size && this.lastConnectedAt && Date.now() - this.lastConnectedAt > DISCONNECT_TIMEOUT) {
				logger.info('No subscribers after 30 seconds, ending session');
				this.sessionId = null;
				await this.#setAvailable();
			}
		}, 1000);
	}

	async #setAvailable() {
		logger.info(`Setting browser ${this.workerId} as AVAILABLE`);
		await redis.sadd('browser:available', this.workerId);
		await redis.set(`browser:${this.workerId}`, JSON.stringify({ baseUrl: this.baseUrl, state: 'available' }));
	}

	async #setBusy() {
		logger.info(`Setting browser ${this.workerId} as BUSY`);
		await redis.srem('browser:available', this.workerId);
		await redis.set(`browser:${this.workerId}`, JSON.stringify({ baseUrl: this.baseUrl, state: 'busy' }));
	}

	async #setOffline() {
		logger.info(`Setting browser ${this.workerId} as OFFLINE`);
		await redis.del(`browser:${this.workerId}`);
		await redis.srem('browser:available', this.workerId);
	}

	async #getPage(): Promise<Page | null> {
		if (!this.browser) { return null; }
		const pages = await this.browser.pages();
		if (pages.length) return pages[0];

		const page = await this.browser.newPage();
		return page;
	}

	async close() {
		this.isShuttingDown = true;
		await this.#setOffline();
		await this.browser?.disconnect();
	}

	async launch() {
		try {
			const browserData = await getBrowserData();
			this.browserWsUrl = browserData.webSocketDebuggerUrl;
			if (!this.browserWsUrl) {
				throw new Error('Browser not connected');
			}
			this.proxySocket = new WebSocket(this.browserWsUrl);
			logger.info('browserData', JSON.stringify(browserData));
			this.browser = await puppeteer.connect({ browserWSEndpoint: this.browserWsUrl });

			const onShinpadsUpdate = (msg: string) => {
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
				} catch (_) {
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
							const script = injectScript();
							await page.evaluate(script);
							await page.evaluate(browserPageScripts);
						}
					};

					page.on('response', onResponse);
					page.on('framenavigated', onFrameNavigated);
				}
			};

			const onBrowserDisconnected = async () => {
				console.log('onBrowserDisconnected');
				this.connected = false;
				await this.#setOffline();
				this.browser = null;
				this.sessionId = null;
				this.io.disconnectSockets();
			};

			this.browser.on('disconnected', onBrowserDisconnected);
			this.browser.on('targetcreated', onTargetCreated);

			const pages = await this.browser.pages();
			pages.forEach((page) => {
				page.close();
			});

			const page = await this.browser.newPage();
			await page.goto('https://google.com');

			this.connected = true;
			this.hasBeenConnected = true;
			await this.#setAvailable();

			logger.info(`Browser connected on ${this.browserWsUrl}`);
		} catch (_) {
			logger.error('Failed to launch browser...');
		}
	}

	async startSession(sessionId: string) {
		if (!this.browser) {
			logger.error('Browser not connected');
			return { success: false, message: 'Browser not connected' };
		}

		await this.#setBusy();
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
			const page = await this.#getPage();
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
				await page.evaluate((shinpadsId, value) => {
					// @ts-ignore
					const inputEl = document.querySelector(`[shinpads-id="${shinpadsId}"]`);
					inputEl.value = value;
					inputEl.dispatchEvent(new Event('input', { bubbles: true }));
				}, update.data.shinpadsId, update.data.value);
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
		const page = await this.#getPage();
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
		this.lastConnectedAt = Date.now();
		await this.sendPageContent();
	}

	async removeSubscriber(socketId: string) {
		this.subscribers.delete(socketId);
		this.lastConnectedAt = Date.now();
		logger.info(`Removed subscriber ${socketId}, ${this.subscribers.size} subscribers remaining`);
		if (this.subscribers.size === 0 && this.connected) {
			this.sessionId = null;
			await this.#setAvailable();
		}
	}

	async getStaticResource(path: string) {
		const page = await this.#getPage();
		if (!page) { return null; }

		await page.waitForSelector('body');

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


	/**
	 * Runs a web action on the given page.
	 *
	 * @param {Page} page - The Puppeteer page object to run the action on.
	 * @param {WebAction} action - The web action to be executed.
	 * @param {string} rootElementId - The shinpads-id of the root element to search within
	 * @returns {any} - The result of the action. Can be boolean for actions, or any type of data for extracting
	 */
	async #runAction(page: Page, action: WebAction, rootElementId: string) {
		try {
			logger.info('Running action', action.parameter?.name, action.type, action.parameter?.type, rootElementId);

			if (action.type === 'navigate') {
				await this.processUpdate({ type: 'navigate', data: action.url });
				return true;
			}

			const elements = await page.evaluate((action, rootElementId) => {
				const parentElement = document.querySelector(`[shinpads-id="${rootElementId}"]`);
				const elements = window.getElementsFromData(parentElement, action.element);
				return elements.map((el) => window.getElementData(el));
			}, action, rootElementId);

			if (!elements.length) {
				logger.warn('No elements found for action', action.parameter?.name, action.type, action.parameter?.type, rootElementId);
				return false;
			}

			const getActionElementValue = async (element) => {
				if (action.parameter.type === 'object') {
					// call for all subactions
					const res: Record<string, any> = {};
					for (const subAction of action.subActions) {
						res[subAction.parameter.name] = await this.#runAction(page, subAction, element.attributes['shinpads-id']);
					}
					return res;
				} else if (action.parameter.type === 'text') {
					return element.text;
				} else if (action.parameter.type === 'image') {
					// todo: check recursivley for image, background-image, etc
					return element.attributes['src'];
				}
				return null;
			};

			 if (action.type === 'action') {
				if (action.parameter.type === 'click') {
					await this.processUpdate({ type: 'click', data: { shinpadsId: elements[0].shinpadsId } });
				} else if (action.parameter.type === 'input') {
					await this.processUpdate({ type: 'click', data: { shinpadsId: elements[0].shinpadsId } });
					await page.keyboard.type(action.parameter.name);
				}
			} else if (action.type === 'extract') {
				// find element, recursivley run action
				if (action.parameter.isArray) {
					return await Promise.all(elements.map((el) => getActionElementValue(el)));
				} else {
					return await getActionElementValue(elements[0]);
				}
			}

			// wait 200ms
			await new Promise((resolve) => setTimeout(resolve, 200));
			await page.waitForNetworkIdle();
			return true;

		} catch (error) {
			logger.error('Failed to run web action', error);
			return false;
		}
	}

	async runWebAction(browserSessionId: string, action: WebAction) {
		const page = await this.#getPage();
		if (!page) { return false; }


		if (browserSessionId !== this.sessionId) {
			logger.error('Browser session id does not match');
			return false;
		}
		await page.waitForNetworkIdle();

		// find body's shinpads id
		const rootElement = await page.evaluate(() => {
			const body = document.querySelector('body');
			return body?.getAttribute('shinpads-id');
		});
		await this.publishUpdate({ type: 'action-start', data: { actionId: action.id } });
		const response = await this.#runAction(page, action, rootElement);
		await this.publishUpdate({ type: 'action-end', data: { actionId: action.id, response } });
		return response;
	}


}


export default Potato;
