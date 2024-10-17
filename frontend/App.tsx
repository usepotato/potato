import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Input, ListItemButton, ListItem, List, Modal, ModalDialog, Typography, ListItemContent } from '@mui/joy';
import { io, Socket } from 'socket.io-client';
import styled from '@emotion/styled';
import ArrowBackIcon from 'icons/ArrowBackIcon';
import ReloadIcon from 'icons/ReloadIcon';
import LogoIcon from 'icons/LogoIcon';
import MouseClickIcon from 'icons/MouseClickIcon';
import CubeIcon from 'icons/CubeIcon';
import CursorTypingIcon from 'icons/CursorTypingIcon';
import ImageIcon from 'icons/ImageIcon';
import TextIcon from 'icons/TextIcon';
import FullArrowUpIcon from 'icons/FullArrowUpIcon';
import { appendIFrameStyle, buildLowestListParent, ElementData, Events, getElementData, getElementsFromData } from './util';

const PageContainer = styled(Box)`
	height: 100vh;
	width: 100vw;
	display: flex;
	flex-direction: column;
	background-color: #fafafa;
	background-image: linear-gradient(to right, #d9d9d9 1px, transparent 1px), linear-gradient(to bottom, #d9d9d9 1px, transparent 1px);
	background-size: 32px 32px;
`;

const BrowserContainer = styled(Box)`
	flex-grow: 1;
	// height: calc(100% - 8px);
	height: 100%;
	width: 100%;
	background-color: rgba(240, 240, 240, 0.70);
	backdrop-filter: blur(8px);
	border-radius: 5px;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	border: 1px solid #e4e4e4;
`;

const BrowserNavBar = styled(Box)`
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px;
	// background-color: #fafafa;
	border-bottom: 1px solid #e4e4e4;
	height: 48px;
	align-items: center;
`;

const NavButtons = styled(Box)`
	display: flex;
	gap: 4px;
	margin-right: 8px;
`;

const UrlBar = styled(Box)`
	display: flex;
	gap: 0.5rem;
	flex-grow: 1;
`;

const BrowserContent = styled(Box)`
	flex-grow: 1;
	position: relative;
`;

const PageContentContainer = styled(Box)`
	display: flex;
	height: 100%;
`;

// position={'absolute'} top={0} left={0} width={'100%'} height={'100%'} display={'flex'} justifyContent={'center'} alignItems={'center'}
const LoadingOverlay = styled(Box)<{ loading: boolean }>`
	position: absolute;
	top: 0;
	left: 0;
	width: 100%;
	height: 100%;
	display: flex;
	justify-content: center;
	align-items: center;
	background-color: ${({ loading }) => loading ? 'rgba(243, 244, 255, 0.25)' : 'rgb(243 244 255 / 0%);'};
	backdrop-filter: ${({ loading }) => loading ? 'blur(4px)' : 'blur(0px)'};
	pointer-events: none;
	transition: background-color 0.20s ease-in-out, backdrop-filter 0.20s ease-in-out;
`;

const Iframe = styled('iframe')`
		width: 100%;
		height: 100%;
		border: none;
		background-color: #fff;
`;

export const SELECT_MODE = {
	UNIQUE: 'unique',
	ALL: 'all',
};

interface NodeJson {
	tagName: string;
	isText: boolean;
	attributes: Record<string, string>;
	children: NodeJson[];
	text?: string;
	html?: string;
}

const addNodeFromJson = (containerElement: Element, nj: NodeJson, contentDocument: Document) => {
	let element;
	if (!nj) return null;
	if (nj.tagName === 'body') {
		element = contentDocument?.body;
		if (!element) {
			element = contentDocument?.createElement('body');
		}
	} else if (nj.isText) {
		element = contentDocument?.createTextNode(nj.text || '');
	} else {
		element = contentDocument?.createElement(nj.tagName);
	}


	Object.entries(nj.attributes || {}).forEach(([key, value]) => {
		element.setAttribute(key, value);
	});

	containerElement.appendChild(element);

	nj.children?.forEach((child) => {
		addNodeFromJson(element, child, contentDocument);
	});


	if (element.parentElement === containerElement) {
		containerElement.querySelectorAll('svg').forEach((svg) => {
			// eslint-disable-next-line
			svg.outerHTML = svg.outerHTML;
		});
	}


	return element;
};

const App: React.FC = () => {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const [socket, setSocket] = useState<Socket | null>(null);
	const [url, setUrl] = useState('');
	const [loading, setLoading] = useState(true);
	const [ping, setPing] = useState(0);
	const [connected, setConnected] = useState(false);
	const [mutationBacklog, setMutationBacklog] = useState<any[]>([]);
	const urlRef = useRef(url);
	const backlogRef = useRef(mutationBacklog);
	const [shiftPressed, setShiftPressed] = useState(false);
	const [metaPressed, setMetaPressed] = useState(false);

	const [activeAction, setActiveAction] = useState<any | null>(null);
	const [currentElement, setCurrentElement] = useState<HTMLElement | null>(null);
	const currentElementRef = useRef<HTMLElement | null>(null);
	const [hoveredElement, setHoveredElement] = useState<HTMLElement | null>(null);
	const [isCreatingAction, setIsCreatingAction] = useState(false);
	const [activeElements, setActiveElements] = useState<HTMLElement[]>([]);
	const [activeListElement, setActiveListElement] = useState<HTMLElement | null>(null);
	const [nonListContextElement, setNonListContextElement] = useState<HTMLElement | null | undefined>(null);
	const [listElement, setListElement] = useState<HTMLElement | null>(null);
	const [allListElements, setAllListElements] = useState<ElementData[]>([]);
	const [listItemElement, setListItemElement] = useState<HTMLElement | null>(null);
	const [currentList, setCurrentList] = useState<HTMLElement[]>([]);
	const [currentListStack, setCurrentListStack] = useState<ElementData[]>([]);
	const [doc, setDoc] = useState<Document | null>(null);
	const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
	const [selectMode, setSelectMode] = useState<string | null>(null);


	const [mouseWithinIframe, setMouseWithinIframe] = useState(true);

	const selectModeRef = useRef(false);

	useEffect(() => {
		selectModeRef.current = Boolean(selectMode) || (activeAction && activeAction.type === 'extract' && activeAction.parameter.type === 'object');
	}, [selectMode, activeAction]);

	useEffect(() => {
		currentElementRef.current = currentElement;
	}, [currentElement]);


	function clearHighlights(...classNames: string[]) {
		for (const className of classNames) {
			doc?.querySelectorAll(`.${className}`).forEach(element => {
				element.remove();
			});
		}
	}

	function createHighlight(element: HTMLElement, className: string = 'shinpads-highlight', ...classes: string[]) {
		if (!doc) return;
		const highlight = doc.createElement('div');
		highlight.classList.add(className);
		highlight.classList.add('shinpads-overlay');
		classes.forEach(c => highlight.classList.add(c));
		doc.body.appendChild(highlight);

		const rect = element.getBoundingClientRect();
		const scrollX = doc.documentElement.scrollLeft;
		const scrollY = doc.documentElement.scrollTop;
		highlight.style.left = `${rect.left + scrollX - 2}px`;
		highlight.style.top = `${rect.top + scrollY - 2}px`;
		highlight.style.width = `${rect.width + 4}px`;
		highlight.style.height = `${rect.height + 4}px`;

		highlight.style.borderRadius = element.style.borderRadius || '4px';

		return highlight;
	}

	useEffect(() => {
		urlRef.current = url;
	}, [url]);

	useEffect(() => {
		backlogRef.current = mutationBacklog;
	}, [mutationBacklog]);

	useEffect(() => {
		if (shiftPressed && metaPressed) {
			setSelectMode(SELECT_MODE.ALL);
		} else if (metaPressed) {
			setSelectMode(SELECT_MODE.UNIQUE);
		} else {
			setSelectMode(null);
		}
	}, [shiftPressed, metaPressed, setSelectMode]);


	useEffect(() => {
		const setup = async () => {
			const _socket = io('/', {
				query: {
					inspector: true,
				},
				transports: ['websocket'],
				reconnection: true,
				reconnectionAttempts: Infinity,
				reconnectionDelay: 5000,
				reconnectionDelayMax: 15000,
			});

			setSocket(_socket);

			setInterval(() => {
				const start_t = Date.now();
				_socket.emit('ping', start_t);
			}, 1000);


			_socket.on('pong', (start_t) => {
				const latency = Date.now() - start_t;
				setPing(latency);
			});

			_socket.on('connect', () => {
				console.log('Connected to server');
				_socket.emit('browser-update', { type: 'resize', data: { width: iframeRef.current?.offsetWidth || 0, height: iframeRef.current?.offsetHeight || 0 } });
				_socket.emit('browser-update', { type: 'scroll', data: { x: iframeRef.current?.scrollLeft || 0, y: iframeRef.current?.scrollTop || 0	 } });
				setConnected(true);
			});
			_socket.on('disconnect', () => {
				console.log('Disconnected from server');
				setConnected(false);
			});

			_socket.on('browser-update', async (payload) => {
				const { type, data } = payload;
				if (type === 'loading') {
					console.log('----LOADING UPDATE---', data);
					setLoading(data.loading);
					if (data.url) {
						urlRef.current = data.url;
						backlogRef.current.forEach((mutation) => {
							processMutation(mutation);
						});
					}
				}
				if (type === 'page2') {
					console.log('----PAGE2 UPDATE---', data);
					if (iframeRef.current?.contentWindow) {
						setUrl(data.url);
						urlRef.current = data.url;
						iframeRef.current.contentWindow.document.open();
						iframeRef.current.contentWindow.document.write('<!DOCTYPE html>' + data.baseHtml);
						iframeRef.current.contentWindow.document.close();
						setLoading(false);

						_socket.emit('browser-update', { type: 'resize', data: { width: iframeRef.current.offsetWidth, height: iframeRef.current.offsetHeight } });


						addNodeFromJson(iframeRef.current.contentWindow.document.documentElement, data.body, iframeRef.current.contentWindow.document);
						backlogRef.current.forEach((mutation) => {
							processMutation(mutation);
						});
						setMutationBacklog([]);
					}
				}
				if (type === 'scroll') {
					if (iframeRef.current) {
						iframeRef.current.scrollTop = data.y;
						iframeRef.current.scrollLeft = data.x;
					}
				}
				if (type === 'mutation') {
					if (data.url !== urlRef.current) {
						console.log('adding mutation to backlog', data);
						setMutationBacklog((prev) => [...prev, data]);
						return;
					}
					processMutation(data);
				}
			});

			const processMutation = (data: any) => {
				if (data.url !== urlRef.current) {
					console.warn('ignoring mutation for wrong url', data);
					return;
				}
				if (!iframeRef.current?.contentDocument) {
					console.warn('no iframe content document', data);
					return;
				}

				let element = iframeRef.current.contentDocument.querySelector(`[shinpads-id="${data.shinpadsId}"]`);
				if (data.shinpadsId === 0) {
					element = iframeRef.current.contentDocument.body.parentElement;
				}
				if (!element) {
					console.error('element not found', data, iframeRef.current.contentDocument.body.cloneNode(true));
					return;
				}
				if (data.type === 'childList') {
					const nextSibling = data.nextSibling ? iframeRef.current.contentDocument.querySelector(`[shinpads-id="${data.nextSibling}"]`) : null;
					const previousSibling = data.previousSibling ? iframeRef.current.contentDocument.querySelector(`[shinpads-id="${data.previousSibling}"]`) : null;
					data.addedNodes?.forEach((node) => {
						if (!node.shinpadsId && node.text) {
							element.textContent = node.text;
						} else {
							const existingElement = iframeRef.current?.contentDocument?.querySelector(`[shinpads-id="${node.shinpadsId}"]`);
							if (existingElement) {
								existingElement.remove();
							}

							if (!node) return;
							if (!iframeRef.current?.contentDocument) return;

							const nodeElement = addNodeFromJson(element, node.node, iframeRef.current.contentDocument);
							if (!nodeElement) {
								console.error('nodeElement not found', data);
								return;
							}

							element.appendChild(nodeElement);

							try {
								if (nextSibling) {
									element.insertBefore(nodeElement, nextSibling);
								} else if (previousSibling) {
									element.insertBefore(nodeElement, previousSibling.nextSibling);
								}
							} catch (e) {
								console.error('error inserting', { element, nodeElement, nextSibling, previousSibling });
							}

						}
					});

					data.removedNodes?.forEach((node) => {
						element.querySelectorAll(`[shinpads-id="${node}"]`)?.forEach((node) => {
							node.remove();
						});
					});

				} else if (data.type === 'attributes') {
					if (element) {
						element.setAttribute(data.attributeName, data.value);
					}
				} else if (data.type === 'add-style') {
					const sheet = (element as HTMLStyleElement).sheet;
					if (!sheet) {
						console.warn('no sheet', element);
						return;
					}
					sheet.insertRule(data.rule, sheet.cssRules.length);
				} else if (data.type === 'remove-style') {
					const sheet = (element as HTMLStyleElement).sheet;
					if (!sheet) {
						console.warn('no sheet', element);
						return;
					}
					sheet.deleteRule(data.index);
				}
			};

			_socket.on('error', (error) => {
				console.error('Error:', error);
			});
		};

		setup();
		return () => {
			console.log('Unmounting, disconnecting socket');
			socket?.disconnect();
		};
	}, []);


	const onUrlChange = (e: React.FormEvent<HTMLDivElement>) => {
		e.preventDefault();
		let parsedUrl = url;
		if (!parsedUrl.startsWith('http')) {
			parsedUrl = 'https://' + parsedUrl;
		}
		socket?.emit('browser-update', { type: 'navigate', data: parsedUrl });
	};

	const onGoBack = () => {
		socket?.emit('browser-update', { type: 'go-back' });
	};

	const onGoForward = () => {
		socket?.emit('browser-update', { type: 'go-forward' });
	};

	const onReload = () => {
		socket?.emit('browser-update', { type: 'reload' });
	};

	const onBrowserUpdate = (update: any) => {
		socket?.emit('browser-update', update);
	};

	const onIFrameClick = (event: MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();
		console.log('onIFrameClick', event);
		const clickedElement = event.target as HTMLElement;

		if (selectModeRef.current && currentElementRef.current) {
			console.log('selectMode', currentElementRef.current);
			setIsCreatingAction(true);
		} else {
			onBrowserUpdate({ type: 'click', data: { x: event.clientX, y: event.clientY, shinpadsId: clickedElement?.getAttribute('shinpads-id') } });
		}

	};

	const onDocLoaded = () => {
		if (!iframeRef.current?.contentWindow) {
			return;
		}

		const nDoc = iframeRef.current.contentWindow.document;

		iframeRef.current.contentWindow.addEventListener('blur', () => {
			setSelectMode(null);
		});

		nDoc.addEventListener('mouseenter', () => {
			iframeRef?.current?.contentWindow?.focus();
		});


		setDoc(nDoc);

		iframeRef.current.contentWindow.focus();

		appendIFrameStyle(nDoc);
		// maybe TODO: For click and mousemove, can just get the element that is clicked/hovered to save a lot of network usage!
		nDoc.removeEventListener('click', onIFrameClick);
		nDoc.addEventListener('click', onIFrameClick);

		nDoc.addEventListener('mousemove', (event) => {
			onBrowserUpdate({ type: 'mousemove', data: { x: event.clientX, y: event.clientY } });
			const elements = nDoc.elementsFromPoint(event.clientX, event.clientY);

			const originalElement = elements.find(el => !el.classList.contains('shinpads-overlay'));

			let element = originalElement;
			while (originalElement && element && element.parentElement && originalElement.getBoundingClientRect().width >= element.parentElement.getBoundingClientRect().width && originalElement.getBoundingClientRect().height >= element.parentElement.getBoundingClientRect().height) {
				element = element.parentElement;
			}

			setHoveredElement(element as HTMLElement);
		});

		nDoc.addEventListener('keydown', (event) => {
			onBrowserUpdate({ type: 'keydown', data: { key: event.key } });
			if (event.key === 'Meta') {
				setMetaPressed(true);
			} else if (event.key === 'Shift') {
				setShiftPressed(true);
			}
		});

		nDoc.addEventListener('keyup', (event) => {
			if (event.key === 'Meta') {
				setMetaPressed(false);
			} else if (event.key === 'Shift') {
				setShiftPressed(false);
			}
		});

		nDoc.addEventListener('scroll', () => {
			onBrowserUpdate({ type: 'scroll', data: { x: iframeRef?.current?.contentWindow?.scrollX, y: iframeRef?.current?.contentWindow?.scrollY } });
		});

		nDoc.addEventListener('input', (event: InputEvent) => {
			onBrowserUpdate({
				type: 'input',
				data: {
					value: (event.target as HTMLInputElement).value,
					shinpadsId: (event.target as HTMLInputElement).getAttribute('shinpads-id')
				}
			});
		});
	};

	useEffect(() => {
		if (!iframeRef.current || !socket) return;

		const resizeObserver = new ResizeObserver(() => {
			if (iframeRef.current) {
				const { offsetWidth, offsetHeight } = iframeRef.current;
				onBrowserUpdate({ type: 'resize', data: { width: offsetWidth, height: offsetHeight } });
			}
		});
		resizeObserver.observe(iframeRef.current);

		onBrowserUpdate({ type: 'resize', data: { width: iframeRef.current.offsetWidth, height: iframeRef.current.offsetHeight } });
		onBrowserUpdate({ type: 'scroll', data: { x: iframeRef.current.scrollLeft, y: iframeRef.current.scrollTop } });

		if (iframeRef.current.getAttribute('data-shinpads-iframe')) {
			return;
		}

		iframeRef.current.setAttribute('data-shinpads-iframe', 'true');
		iframeRef.current.removeEventListener('load', onDocLoaded);
		iframeRef.current.addEventListener('load', onDocLoaded);

		return () => {
			resizeObserver.disconnect();
		};
	}, [socket]);


	useEffect(() => {
		clearHighlights('shinpads-highlight.active', 'shinpads-highlight.active-secondary', 'shinpads-highlight.active-container');
		if (activeAction && doc) {
			const elements = getElementsFromData(doc, activeAction.element);
			console.log(elements);

			// TODO: apply filters

			if (activeAction.type === 'extract' && activeAction.parameter.type === 'object') {
				setActiveElements(elements);

				let newActiveListElement = null;
				if (elements.length > 0) {
					newActiveListElement = elements[0]?.parentElement;
					// get the lowest parent that contains all the elements
					while (elements.some(el => !newActiveListElement.contains(el))) {
						newActiveListElement = newActiveListElement?.parentElement;
					}
				}
				setActiveListElement(newActiveListElement);

				(activeAction.subActions || activeAction.subData)?.forEach(subAction => {
					const subListItems = getElementsFromData(doc, subAction.element);
					elements.forEach(el => {
						const elSubElements = subListItems.filter(el2 => el.contains(el2));
						// subAction.filters?.forEach(filter => {
						// 	elSubElements = getFilteredListItems(elSubElements, filter);
						// });
						elSubElements.forEach(el2 => {
							createHighlight(el2, 'shinpads-highlight', 'active-secondary');
						});
					});
				});

				elements.forEach(element => {
					createHighlight(element, 'shinpads-highlight', 'active-container');
				});
			} else {
				elements.forEach(element => {
					createHighlight(element, 'shinpads-highlight', 'active');
				});
			}
		}
	}, [activeAction, activeAction?.subActions, windowSize]);

	useEffect(() => {
		if (!hoveredElement || !doc) return;

		// if (activeElements.length > 0) {
		// 	// activeElements means we're inspecting an object
		// 	// TODO:
		// 	// if (!activeListElement.contains(GLOBAL.currentElement)) {
		// 	// 	clearHighlights();
		// 	// 	return;
		// 	// }

		// 	clearHighlights('shinpads-highlight');

		// 	console.log('activeListElement', activeListElement);

		// 	createHighlight(hoveredElement, 'shinpads-highlight');

		// 	// const { stack } = buildListParent(currentElement, activeListElement);
		// 	// const { items: listItems, stack: listStack } = getMatchingListItemsFromStack(activeListElement, stack);

		// 	// setListElement(activeListElement);
		// 	// setListItemElement(listItems[0]);
		// 	// setCurrentList(listItems);
		// 	// console.log('currentList', currentList);

		// 	// for (const el of listItems) {
		// 	// 	createHighlight(el, 'shinpads-highlight');
		// 	// }
		// } else {
		iframeRef?.current?.contentWindow?.focus();
		const elementData = getElementData(hoveredElement);
		const listItems = getElementsFromData(doc, elementData);
		const { listElement, allListElements, nonListContextElement } = buildLowestListParent(doc, hoveredElement);
		if (activeElements.length > 0) {
			// check that hovered element is inside an active list element
			if (!activeListElement?.contains(hoveredElement)) {
				setCurrentElement(null);
				setCurrentList([]);
				return;
			}
		}
		setCurrentElement(hoveredElement);
		setNonListContextElement(nonListContextElement);
		setListElement(listElement);
		setListItemElement(listItems[0]);
		setCurrentList(listItems);
		setCurrentListStack([]);
		setAllListElements(allListElements as ElementData[]);
		// }
	}, [hoveredElement]);

	// HIGHLIGHTS
	useEffect(() => {
		clearHighlights('shinpads-current-element', 'shinpads-highlight.secondary');
		if (!currentElement) return;
		if (!isCreatingAction && (!selectMode || !mouseWithinIframe) && !activeListElement) return;


		createHighlight(currentElement, 'shinpads-highlight', 'shinpads-current-element');

		currentList.forEach(element => {
			if (element === currentElement) return;
			createHighlight(element, 'shinpads-highlight', 'secondary');
		});

	}, [currentElement, currentList, selectMode, mouseWithinIframe, isCreatingAction, windowSize]);

	const onCreateAction = (actionData) => {
		if (!currentElement) return;

		const action: any = {
			id: `action_${actionData.type}_${Date.now()}`,
			element: getElementData(currentElement),
			filters: [],
		};

		if (actionData.type === 'action') {
			action.type = 'action';
			action.parameter = {
				type: actionData.actionType,
				isArray: selectMode === SELECT_MODE.ALL,
				name: '',
			};
			action.subActions = [];
		} else if (actionData.type === 'extract') {
			action.type = 'extract';
			action.parameter = {
				type: actionData.paramType,
				isArray: selectMode === SELECT_MODE.ALL,
				name: '',
			};
			action.subActions = [];
		}
		window.parent.postMessage({ type: Events.ON_CREATE_ACTION, action }, '*');
		setIsCreatingAction(false);
	};

	const selectParent = () => {
		if (!currentElement || currentElement.tagName === 'BODY') {
			return;
		}
		setHoveredElement(currentElement?.parentElement);
	};

	return (
		<PageContainer>
			<Modal
				open={isCreatingAction}
				onClose={() => {
					setIsCreatingAction(false);
				}}
				sx={{
					'& .MuiModal-backdrop': {
						backdropFilter: 'blur(0px)',
					},
				}}
			>
				<ModalDialog
					sx={{
						p: 1,
						backgroundColor: 'rgba(250, 250, 250, 0.75)',
						backdropFilter: 'blur(6px)',
						boxShadow: '0 1px inset var(--joy-palette-third-shadowHighColor)',
					}}
				>
					<List sx={{ p: 0 }}>
						{currentElement?.tagName !== 'BODY' && (
							<ListItem>
								<ListItemButton onClick={() => selectParent()}>
									<Box display='flex' alignItems='center' justifyContent='center'>
										<FullArrowUpIcon fill='currentColor' width={16} height={16} />
									</Box>
									<ListItemContent>
										<Typography level='title-sm'>Select Parent</Typography>
										<Typography textColor='neutral.500' level='body-xs'>Select the parent of the element</Typography>
									</ListItemContent>
								</ListItemButton>
							</ListItem>
						)}
						<ListItem>
							<ListItemButton onClick={() => onCreateAction({ type: 'action', actionType: 'click' })}>
								<Box display='flex' alignItems='center' justifyContent='center'>
									<MouseClickIcon fill='currentColor' width={16} height={16} />
								</Box>
								<ListItemContent>
									<Typography level='title-sm'>Click</Typography>
									<Typography textColor='neutral.500' level='body-xs'>Click on the element</Typography>
								</ListItemContent>
							</ListItemButton>
						</ListItem>
						<ListItem>
							<ListItemButton onClick={() => onCreateAction({ type: 'action', actionType: 'input' })}>
								<Box display='flex' alignItems='center' justifyContent='center'>
									<CursorTypingIcon fill='currentColor' width={16} height={16} />
								</Box>
								<ListItemContent>
									<Typography level='title-sm'>Input</Typography>
									<Typography textColor='neutral.500' level='body-xs'>Input on the element</Typography>
								</ListItemContent>
							</ListItemButton>
						</ListItem>
						<ListItem>
							<ListItemButton onClick={() => onCreateAction({ type: 'extract', paramType: 'object' })}>
								<Box display='flex' alignItems='center' justifyContent='center'>
									<CubeIcon fill='currentColor' width={16} height={16} />
								</Box>
								<ListItemContent>
									<Typography level='title-sm'>Extract Object</Typography>
									<Typography textColor='neutral.500' level='body-xs'>Extract object from the element</Typography>
								</ListItemContent>
							</ListItemButton>
						</ListItem>
						<ListItem>
							<ListItemButton onClick={() => onCreateAction({ type: 'extract', paramType: 'text' })}>
								<Box display='flex' alignItems='center' justifyContent='center'>
									<TextIcon fill='currentColor' width={16} height={16} />
								</Box>
								<ListItemContent>
									<Typography level='title-sm'>Extract Text</Typography>
									<Typography textColor='neutral.500' level='body-xs'>Extract text from the element</Typography>
								</ListItemContent>
							</ListItemButton>
						</ListItem>
						<ListItem>
							<ListItemButton onClick={() => onCreateAction({ type: 'extract', paramType: 'image' })}>
								<Box display='flex' alignItems='center' justifyContent='center'>
									<ImageIcon fill='currentColor' width={16} height={16} />
								</Box>
								<ListItemContent>
									<Typography level='title-sm'>Extract Image</Typography>
									<Typography textColor='neutral.500' level='body-xs'>Extract image from the element</Typography>
								</ListItemContent>
							</ListItemButton>
						</ListItem>
					</List>
				</ModalDialog>
			</Modal>
			<PageContentContainer>
				<BrowserContainer boxShadow='md'>
					<BrowserNavBar>
						<Box display='flex' borderRadius="5px" marginLeft={0.5}>
							<LogoIcon width={32} height={32} />
						</Box>
						<NavButtons>
							<IconButton onClick={onGoBack}>
								<ArrowBackIcon width={16} height={16} fill='currentColor' />
							</IconButton>
							<IconButton onClick={onGoForward}>
								<ArrowBackIcon width={16} height={16} fill='currentColor' style={{ transform: 'rotate(180deg)' }} />
							</IconButton>
							<IconButton onClick={onReload}>
								<ReloadIcon width={16} height={16} fill='currentColor' />
							</IconButton>
						</NavButtons>
						<UrlBar component='form' onSubmit={onUrlChange}>
							<Input
								fullWidth
								placeholder='https://google.com'
								onFocus={(e) => e.target.select()}
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								endDecorator={
									<Box display='flex' alignItems='center' gap={.5} marginLeft={1}>
										<Box sx={{ width: '10px', height: '10px', backgroundColor: connected ? 'green' : 'red', borderRadius: '50%' }} />
										{connected && <Typography level='body-xs'>{ping}ms</Typography>}
									</Box>
								}
								sx={{
									boxShadow: 'none',
									'&:before': {
										boxShadow: 'none',
									},
								}}
							/>
						</UrlBar>
					</BrowserNavBar>
					<BrowserContent>
						<Iframe
							ref={iframeRef}
							src={'/'}
						/>
						<LoadingOverlay loading={loading} />
					</BrowserContent>
				</BrowserContainer>
			</PageContentContainer>
		</PageContainer>
	);
};

export default App;
