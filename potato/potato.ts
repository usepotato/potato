import redis from '@lib/redis.js';
import { getBrowserData } from './helper';
import getLogger from '@lib/logging.js';
import puppeteer, { Browser, Frame, HTTPResponse, Page, Target, TargetType, type KeyInput } from 'puppeteer';
import browserPageScripts from './browserPageScripts.js';
import type { Server } from 'socket.io';
import WebSocket from 'ws';
import { injectScript } from './util';
import PotatoAI from 'potatoai.js';
import type { WebAction } from './types';
import { LRUCache } from 'lru-cache';

const logger = getLogger('potato');

interface BrowserUpdate {
	type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
}

const DISCONNECT_TIMEOUT = 1000 * 30; // 30 seconds

class Potato {
	workerId: string;
	baseUrl: string;
	browser: Browser | null;
	sessionId: string | null;
	// requestCache: Record<string, [Buffer, string]>;
	requestCache: LRUCache<string, [Buffer, string]>;
	io: Server;
	subscribers: Set<string>;
	browserWsUrl?: string;
	proxySocket: WebSocket | null;
	connected: boolean;
	isShuttingDown: boolean;
	hasBeenConnected: boolean;
	lastConnectedAt: number | null;
	openRequests: Map<Page, Set<string>>;
	pageInitialized: Map<Page, boolean>;

	constructor(io: Server, workerId: string, baseUrl: string) {
		this.io = io;
		this.workerId = workerId;
		this.baseUrl = baseUrl;
		this.browser = null;
		this.sessionId = null;
		this.requestCache = new LRUCache<string, [Buffer, string]>({ max: 1000 });
		this.subscribers = new Set<string>();
		this.proxySocket = null;
		this.connected = false;
		this.isShuttingDown = false;
		this.hasBeenConnected = false;
		this.lastConnectedAt = null;
		this.openRequests = new Map<Page, Set<string>>();
		this.pageInitialized = new Map<Page, boolean>();
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
		let pages = await this.browser.pages();
		pages = pages.filter((page) => !page.isClosed());
		if (pages.length) {
			return pages[pages.length - 1];
		}

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


			const onTargetCreated = async (target: Target) => {
				if (target.type() === TargetType.PAGE) {
					const page = await target.page();
					if (!page) return;

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
							this.requestCache.set(response.url(), [content, contentType]);
						} catch (_) {
							logger.error('Error caching response', response.url());
						}
					};

					const onFrameNavigated = async (frame: Frame) => {
						try {
							if (page.mainFrame() === frame) {
								this.pageInitialized.set(page, false);
								await this.publishUpdate({ type: 'loading', data: { 'loading': true } });
								await page.waitForSelector('body');
								try {
									await page.exposeFunction('shinpadsUpdate', onShinpadsUpdate);
								} catch (_) { /* ignore */ }

								logger.info('Injecting scripts!');
								await page.evaluate(`window.browserSessionId = "${this.sessionId}"`);
								const script = injectScript();
								await page.evaluate(script);
								await page.evaluate(browserPageScripts);
								this.pageInitialized.set(page, true);
							}
						} catch (err) {
							logger.warn('Error injecting scripts', err);
						}
					};

					this.openRequests.set(page, new Set<string>());
					this.pageInitialized.set(page, false);

					page.setRequestInterception(true);
					page.on('request', async (request) => {
						// only count XHR, js, cs, html
						if (request.resourceType() === 'xhr' || request.resourceType() === 'script' || request.resourceType() === 'stylesheet' || request.resourceType() === 'document') {
							this.openRequests.get(page)?.add(request.url());
						}
						request.continue();
					});
					page.on('requestfinished', (request) => {
						if (request.resourceType() === 'xhr' || request.resourceType() === 'script' || request.resourceType() === 'stylesheet' || request.resourceType() === 'document') {
							this.openRequests.get(page)?.delete(request.url());
						}
					});
					page.on('requestfailed', (request) => {
						if (request.resourceType() === 'xhr' || request.resourceType() === 'script' || request.resourceType() === 'stylesheet' || request.resourceType() === 'document') {
							this.openRequests.get(page)?.delete(request.url());
						}
					});

					page.on('response', onResponse);
					page.on('framenavigated', onFrameNavigated);
					page.on('console', (msg) => logger.info('console msg', msg.text()));
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

		try {
			const page = await this.#getPage();
			if (!page) { throw new Error('Failed to get page'); }

			if (update.type === 'resize') {
				await page.setViewport(update.data);
			} else if (update.type === 'click') {
				if (update.data.newTab) {
					// Use page.evaluate to modify the click behavior
					await page.evaluate((shinpadsId) => {
						const element = document.querySelector(`[shinpads-id="${shinpadsId}"]`);
						if (element instanceof HTMLAnchorElement) {
							element.target = '_blank';
						}
					}, update.data.shinpadsId);
					await page.click(`[shinpads-id="${update.data.shinpadsId}"]`);
				} else {
					await page.click(`[shinpads-id="${update.data.shinpadsId}"]`);
				}
				logger.info(`Clicked on ${update.data.x}, ${update.data.y}`);
			} else if (update.type === 'scroll') {
				await page.evaluate(`window.scrollTo(${update.data.x}, ${update.data.y})`);
			} else if (update.type === 'reload') {
				await page.reload();
				await page.waitForNavigation();
			} else if (update.type === 'navigate') {
				await page.goto(update.data);
			} else if (update.type === 'go-back') {
				await page.goBack();
				await page.waitForNavigation();
			} else if (update.type === 'go-forward') {
				await page.goForward();
				await page.waitForNavigation();
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
		try {
			await page.waitForSelector('body');
			// @ts-ignore
			await page.evaluate(() => window.sendPageContent());
		} catch (error) {
			logger.error('Failed to send page content', error);
		}
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

		try {
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

			const cached = this.requestCache.get(path);
			if (cached) {
				const [content, contentType] = cached;
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

			this.requestCache.set(path, [contentBytes, contentType]);
			return { buffer: contentBytes, contentType };
		} catch (error) {
			logger.error('Failed to get static resource', error);
			throw error;
		}
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
			logger.info('RUNNING ACTION', action.id, action.type, JSON.stringify(action.parameter));
			await this.#waitForPageInitialized(page);
			await this.#waitForNetworkIdle(page);

			if (action.type === 'navigate') {
				await this.processUpdate({ type: 'navigate', data: action.parameter.name });
				return true;
			}

			if (action.parameter.type === 'act') {
				const onPotatoAIUpdate = async (update: any) => {
					if (update.type === 'considered-elements') {
						await this.publishUpdate({ type: 'action-update', data: { actionId: action.id, consideredElements: update.data } });
					}
				};

				const shinpadsId = await PotatoAI.act(page, action.parameter.name, onPotatoAIUpdate);
				if (shinpadsId) {
					await this.processUpdate({ type: 'click', data: { shinpadsId } });
					return true;
				}
				return false;
			} else if (action.parameter.type === 'input') {
				const words = action.parameter.name.split(' ');
				for (const word of words) {
					// if word is surrounded by square brackets like [Enter] or [Shift] then pres that key else type the word
					if (word.startsWith('[') && word.endsWith(']')) {
						try {
							await page.keyboard.press(word.slice(1, -1) as KeyInput);
						} catch (_) {
							logger.warn('Failed to press key', word.slice(1, -1));
						}
					} else {
						await page.keyboard.type(word + ' ');
					}
				}
				return true;
			}

			const elements = await page.evaluate((action, rootElementId) => {
				const parentElement = document.querySelector(`[shinpads-id="${rootElementId}"]`);
				const elements = window.getElementsFromData(parentElement, action.element, action.parameter.type === 'click' && !action.parameter.isArray);
				return elements.map((el) => window.getElementData(el));
			}, action, rootElementId);

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

			if (!elements.length) {
				logger.warn('No elements found for action', action.id);
				if (action.parameter.isArray) {
					return [];
				} else {
					return null;
				}
			}

			logger.info(`found ${elements.length} elements for action ${action.id}`);

			if (action.parameter.type === 'extract') {
				if (action.parameter.isArray) {
					// TODO: add array support
					return [];
				} else {
					const elementHtml = await page.evaluate((element) => document.querySelector(`[shinpads-id="${element.shinpadsId}"]`)?.outerHTML, elements[0]);
					return await PotatoAI.extract(elementHtml, action, () => {});
				}
			} else if (action.parameter.type === 'click') {
				if (action.parameter.isArray) {
					// click but in new tab. and then close the page when all sub actions are completed.
					const response = [];
					for (const element of elements) {
						const res: Record<string, any> = {};
						logger.info('Clicking on element', element.shinpadsId);
						await this.processUpdate({ type: 'click', data: { shinpadsId: element.shinpadsId, newTab: true } });
						// wait for new page to be created
						await new Promise(resolve => this.browser?.once('targetcreated', resolve));
						const newPage = await this.#getPage();
						logger.info('newPage loaded', newPage?.url());
						// wait for page to be loaded
						await this.#waitForPageInitialized(newPage);
						const newBody = await newPage?.evaluate(() => document.querySelector('body')?.getAttribute('shinpads-id'));
						logger.info('newPage', newPage?.url());
						// await this.#waitForNetworkIdle();
						logger.info('Running sub actions', action.subActions.length);
						res._url = newPage?.url();
						for (const subAction of action.subActions) {
							res[subAction.parameter.name] = await this.#runAction(newPage, subAction, newBody);
						}
						response.push(res);
						try {
							await newPage.close();
						} catch (_) {
							logger.warn('Failed to close new page', newPage?.url());
						}
					}
					return response;
				} else {
					await this.processUpdate({ type: 'click', data: { shinpadsId: elements[0].shinpadsId } });
					await page.waitForNavigation({ waitUntil: 'networkidle0' });
				}
			} else {
				// find element, recursivley run action
				if (action.parameter.isArray) {
					return await Promise.all(elements.map((el) => getActionElementValue(el)));
				} else {
					return await getActionElementValue(elements[0]);
				}
			}

			return true;

		} catch (error) {
			logger.error('Failed to run web action', error);
			return false;
		}
	}


	async #waitForNetworkIdle(page: Page) {
		return new Promise<void>((resolve) => {
			const checkIdle = () => {
				if (page.isClosed()) {
					logger.warn('Page closed while waiting for network idle', page.url());
					return resolve();
				}
				if (this.openRequests.get(page)?.size === 0) {
					logger.info(`Network clear, proceeding on ${page.url()}`);
					resolve();
				} else {
					logger.info(`Network busy, with ${this.openRequests.get(page)?.size} requests waiting... on ${page.url()}`);
					setTimeout(checkIdle, 100);
				}
			};
			checkIdle();
		});
	}

	async #waitForPageInitialized(page: Page) {
		return new Promise<void>((resolve) => {
			const checkInitialized = () => {
				if (page.isClosed()) {
					logger.warn('Page closed while waiting for initialization', page.url());
					return resolve();
				}
				if (this.pageInitialized.get(page)) {
					logger.info(`Page ${page.url()} initialized, continuing`);
					resolve();
				} else {
					logger.info(`Page ${page.url()} not initialized, waiting...`);
					setTimeout(checkInitialized, 100);
				}
			};
			checkInitialized();
		});
	}


	async runWebAction(browserSessionId: string, action: WebAction) {
		logger.info('___RUNNING WEB ACTION', action.parameter?.name || '', action.type, action.parameter?.type || '', browserSessionId);
		await this.publishUpdate({ type: 'action-start', data: { actionId: action.id } });

		try{
			const page = await this.#getPage();
			if (!page) {
				logger.error('No page found running action', action.id);
				return false;
			}

			if (browserSessionId !== this.sessionId) {
				logger.error('Browser session id does not match');
				return false;
			}
			logger.info('Waiting for body');
			// find body's shinpads id
			const rootElement = await page.evaluate(() => {
				const body = document.querySelector('body');
				return body?.getAttribute('shinpads-id');
			});
			const response = await this.#runAction(page, action, rootElement);
			logger.info('Waiting for network idle');
			try {
				await Promise.race([
					Promise.all([
						this.#waitForNetworkIdle(page),
						this.#waitForPageInitialized(page)
					]),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout after 30s')), 30000))
				]);
			} catch (_) {
				logger.warn('Waiting 8s for network idle timed out');
			}
			await this.publishUpdate({ type: 'action-end', data: { actionId: action.id, response } });
			return response;
		} catch (error) {
			logger.error('Failed to run web action', error);
			await this.publishUpdate({ type: 'action-end', data: { actionId: action.id, response: false } });
			return false;
		}
	}


}


export default Potato;
