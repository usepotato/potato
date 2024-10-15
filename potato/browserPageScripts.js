/* eslint-disable */
export default () => {
	if (!document.body || window.isShinpadsScriptInjected) {
		window.shinpadsUpdate(JSON.stringify({
			type: 'loading',
			data: {
				loading: false,
				url: window.location.href,
			}
		}));
		return;
	}

	window.isShinpadsScriptInjected = true;

	console.log('INJECTING SHINPADS SCRIPT');


	if (!window.currentShinpadsId) {
		window.currentShinpadsId = 0;
	}

	window.fetchResource = async (url) => {
		const res = await fetch(url);
		return await res.text();
	};

	window.getStyleSheetBase64FromUrl = async (url) => {
		const sheets = document.styleSheets;
		const sheet = Array.from(sheets).find(s => s.href === url);
		if (!sheet) {
			return null;
		}
		try {
			const cssText = Array.from(sheet.cssRules).map(r => r.cssText).join('');
			return btoa(cssText);
		} catch (e) {
			console.warn('error getting css text', e);
			return null;
		}
	};

	window.getBase64FromUrl = async (url) => {
		try{
			const data = await fetch(url);
			const blob = await data.blob();

			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.readAsDataURL(blob);
				reader.onloadend = () => resolve(reader.result);
				reader.onerror = (err) => reject(err);
			});
		} catch (e) {
			console.warn('error getting base64 from url', e);
			return null;
		}
	};

	window.assignDataIds = (element) => {
		if (element?.nodeType !== 1) {
			return;
		}

		if (element.tagName !== 'HTML' && !element.parentElement?.getAttribute?.('shinpads-id')) {
			return window.assignDataIds(element.parentElement);
		}

		const existing = document.querySelectorAll(`[shinpads-id="${element.getAttribute('shinpads-id')}"]`);

		if (!element?.getAttribute?.('shinpads-id') || existing.length > 1) {
			element.setAttribute('shinpads-id', window.currentShinpadsId++);
		}
		element.childNodes.forEach(window.assignDataIds);
	};

	window.getNodeJson = (element) => {
		if (!element || element.tagName === 'SCRIPT' || element.tagName === 'IFRAME') {
			return null;
		}
		const nj =  {
			tagName: element.tagName?.toLowerCase(),
			isText: element.nodeType === 3,
			attributes: Array.from(element.attributes || []).reduce((acc, attr) => {
				acc[attr.name] = attr.value;
				return acc;
			}, {}),
			children: Array.from(element.childNodes || []).map(window.getNodeJson).filter(Boolean),
		};

		if (!nj.tagName) {
			nj.text = element.textContent;
		}
		return nj;
	};

	window.cleanupNode = (node) => {
		if (!node) {
			return null;
		}
		// remove scripts, iframes
		const scripts = node.querySelectorAll('script');
		scripts.forEach(s => s.remove());
		const iframes = node.querySelectorAll('iframe');
		iframes.forEach(i => i.remove());
		const links = node.querySelectorAll('link');
		links.forEach(l => {
			if (l.getAttribute('as')?.toLowerCase() === 'script') {
				l.remove();
			}
		});
		// find imgs, links
		const nodes = Array.from(node.querySelectorAll('img, link'));
		if (node.tagName === 'IMG' || node.tagName === 'LINK') {
			nodes.push(node);
		}
		// check their href or src attribute
		nodes.forEach(n => {
			if (n.src) {
				// replace url to start with /bs/
				if (n.src.startsWith('data:')) {
					return;
				}
				if (n.src.startsWith('//')) {
					n.src = 'https:' + n.src;
				}
				if (n.src.startsWith('/bs/')) {
					return;
				}
				n.setAttribute('src', `/bs/${window.browserSessionId}/${n.src}`);
			}
			if (n.srcset) {
				const updatedSrcset = n.srcset.split(',').map(s => {
					let [src, size] = s.trim().split(/\s+/);
					if (src.startsWith('data:')) {
						return s;
					}
					if (src.startsWith('//')) {
						src = 'https:' + src;
					}
					if (src.startsWith('/bs/')) {
						return s;
					}
					return `/bs/${window.browserSessionId}/${src} ${size}`;
				}).join(', ');
				n.setAttribute('srcset', updatedSrcset);
			}
			if (n.href) {
				if (n.href.startsWith('//')) {
					n.href = 'https:' + n.href;
				}
				if (n.href.startsWith('/bs/')) {
					return;
				}
				n.setAttribute('href', `/bs/${window.browserSessionId}/${n.href}`);
			}
		});

		const divs = Array.from(node.querySelectorAll('div'));
		if (node.tagName === 'DIV') {
			divs.push(node);
		}
		divs.forEach(d => {
			if (d.style.backgroundImage) {
				const match = d.style.backgroundImage.match(/url\(([^)]+)\)/);
				if (match) {
					let url = match[1].replace(/^['"]|['"]$/g, '');
					if (url.startsWith('/bs/')) {
						return;
					}
					if (url.startsWith('//')) {
						url = 'https:' + url;
					}
					if (url.startsWith('data:')) {
						return;
					}
					d.style.backgroundImage = d.style.backgroundImage.replace(match[0], `url(/bs/${window.browserSessionId}/${url})`);
				}
			}
			if (d.style.background) {
				const match = d.style.background.match(/url\(([^)]+)\)/);
				if (match) {
					let url = match[1].replace(/^['"]|['"]$/g, '');
					if (url.startsWith('/bs/')) {
						return;
					}
					if (url.startsWith('//')) {
						url = 'https:' + url;
					}
					if (url.startsWith('data:')) {
						return;
					}
					d.style.background = d.style.background.replace(match[0], `url(/bs/${window.browserSessionId}/${url})`);
				}
			}
		});

		const styleTags = Array.from(node.querySelectorAll('style'));
		if (node.tagName === 'STYLE') {
			styleTags.push(node);
		}
		styleTags.forEach(s => {
			let content = s.innerHTML;
			const urlMatches = content.match(/url\(([^)]+)\)/g);
			if (urlMatches) {
				urlMatches.forEach(match => {
					let url = match.match(/url\(([^)]+)\)/)[1];
					url = url.replace(/^['"]|['"]$/g, '');
					if (url.startsWith('data:')) {
						return;
					}
					if (url.startsWith('//')) {
						url = 'https:' + url;
					}
					if (url.startsWith('/bs/')) {
						return;
					}
					content = content.replace(match, match.replace(url, `/bs/${window.browserSessionId}/${url}`));
				});
				s.innerHTML = content;
			}
		});

		return node;
	};

	console.log('sending initial mutation');

	// window.shinpadsUpdate({
	// 	type: 'mutation',
	// 	data: {
	// 		type: 'childList',
	// 		addedNodes: [window.getNodeJson(document.body)],
	// 		shinpadsId: 0,
	// 	}
	// });

	window.assignDataIds(document.body.parentElement);

	window.setupMutationObserver = () => {
		if (window.shinpadsObserver) {
			window.shinpadsObserver.disconnect();
		}

		console.log('SETTING UP NEW SHINPADS MUTATION OBSERVER');


		const originalInsertRule = CSSStyleSheet.prototype.insertRule;
		const originalDeleteRule = CSSStyleSheet.prototype.deleteRule;

		CSSStyleSheet.prototype.insertRule = function(rule, index) {
			this.ownerNode.innerHTML += rule;
			return originalInsertRule.call(this, rule, index);
		};

		CSSStyleSheet.prototype.deleteRule = function(index) {
			this.ownerNode.innerHTML = this.ownerNode.innerHTML.replace(this.ownerNode.sheet.cssRules[index].cssText, '');
			return originalDeleteRule.call(this, index);
		};


		const targetNode = document.body.parentElement;
		const config = { attributes: true, childList: true, subtree: true };

		const callback = (mutationsList) => {
			// save startShinpadsId so we can tell which elements were added in this mutation (if its greater than this number)
			const startShinpadsId = window.currentShinpadsId;
			const addedElements = [];
			// console.log(`---- mutation ${startShinpadsId} ------`);
			try {
				for (const mutation of mutationsList) {
					// don't send reduntant updates for shinpads-id.
					// any update to shinpads id is either before sending page content or when adding new node.
					// so it will already be added
					if (mutation.attributeName === 'shinpads-id') {
						continue;
					}

					if (mutation.target.tagName === 'SCRIPT' || mutation.target.tagName === 'IFRAME') {
						continue;
					}

					if (mutation.target.tagName === 'LINK' && mutation.target.getAttribute('as')?.toLowerCase() === 'script') {
						continue;
					}

					// it might actually not be necessary to check parentElement?
					// but if current target doesn't have id, that menas its a child of another new node in this update.
					// and since its parent will get passed entirely which encompasses this, we can ignore this update.
					if ((mutation.target.tagName !== 'HTML' && !mutation.target.parentElement?.getAttribute('shinpads-id')) || !mutation.target?.getAttribute('shinpads-id')) {
						continue;
					}

					// if we find an element that was added during this update, we know its already been send since the parent encompassed it
					if (parseInt(mutation.target.getAttribute('shinpads-id')) > startShinpadsId) {
					// means it was created in this cycle and we've already added it by addig the parent
						continue;
					}

					if (addedElements.find(e => e.contains(mutation.target))) {
						continue;
					}

					const addedNodes = [];
					const removedNodes = [];

					mutation.addedNodes.forEach(node => {
						if (node.tagName === 'SCRIPT' && node.getAttribute('type') !== 'text/css') {
							return;
						}
						if (node.tagName === 'IFRAME') {
							return;
						}
						if (node.tagName === 'LINK' && node.getAttribute('as')?.toLowerCase() === 'script') {
							return;
						}
						window.assignDataIds(node);
						if (node.nodeType === 1) {
							addedElements.push(node);
							addedNodes.push({
								shinpadsId: node.getAttribute('shinpads-id'),
								// html: node.outerHTML,
								node: window.getNodeJson(window.cleanupNode(node.cloneNode(true))),
							});
						} else if (node.nodeType === 3 && node.textContent?.trim().length > 0 && node.parentElement) {
							if (!addedElements.find(n => n.shinpadsId === node.parentElement.getAttribute('shinpads-id'))) {
								let text = node?.parentElement?.textContent;
								if (node.parentElement.tagName === 'STYLE') {
									const urlMatches = text.match(/url\(([^)]+)\)/g);
									if (urlMatches) {
										urlMatches.forEach(match => {
											let url = match.match(/url\(([^)]+)\)/)[1];
											url = url.replace(/^['"]|['"]$/g, '');
											if (url.startsWith('data:')) {
												return;
											}
											if (url.startsWith('//')) {
												url = 'https:' + url;
											}
											if (url.startsWith('/bs/')) {
												return;
											}
											text = text.replace(match, match.replace(url, `/bs/${window.browserSessionId}/${url}`));
										});
									}
								}

								addedNodes.push({
									text
								});
							}
						}
					});

					mutation.removedNodes.forEach(node => {
						if (node.nodeType === 1) {
							removedNodes.push(node?.getAttribute?.('shinpads-id'));
						}
					});
					if (mutation.type === 'childList' && addedNodes.length === 0 && removedNodes.length === 0) {
						continue;
					}
					window.shinpadsUpdate(JSON.stringify({
						type: 'mutation',
						data: {
							url: window.location.href,
							type: mutation.type,
							shinpadsId: mutation.target?.getAttribute?.('shinpads-id'),
							attributeName: mutation.attributeName,
							value: mutation.target?.getAttribute(mutation.attributeName),
							addedNodes,
							removedNodes,
							nextSibling: mutation.nextSibling?.getAttribute?.('shinpads-id'),
							previousSibling: mutation.previousSibling?.getAttribute?.('shinpads-id'),
						},
					}));
				}
			} catch (e) {
				console.error('shinpads error in mutation observer', e);
			}
			// console.log(`---- end mutation ${startShinpadsId} ------`);
		};

		window.shinpadsObserver = new MutationObserver(callback);
		window.shinpadsObserver.observe(targetNode, config);
	};

	window.setupMutationObserver();

	window.sendPageContent = async () => {
		console.log('sending page content!!!');
		const htmlBase = document.documentElement.cloneNode(true);
		htmlBase.childNodes.forEach(n => {
			if (n.nodeType === 1 && n.tagName !== 'HEAD') {
				n.remove();
			}
		});

		window.shinpadsUpdate(JSON.stringify({
			type: 'page2',
			data: {
				url: window.location.href,
				body: window.getNodeJson(window.cleanupNode(document.body.cloneNode(true))),
				baseHtml: window.cleanupNode(htmlBase).outerHTML.replace(/\n/g, ''),
			}
		}));
	};

	window.sendPageContent();


}
