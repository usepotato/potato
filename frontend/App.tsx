import React, { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Input, Typography } from '@mui/joy';
import { io, Socket } from 'socket.io-client';
import styled from '@emotion/styled';
import { ReactComponent as ArrowBackIcon } from '@public/icons/arrow-back.svg';
import { ReactComponent as ReloadIcon } from '@public/icons/reload.svg';

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
	// margin: 8px;
	// margin-bottom: 0px;
	// border-bottom-left-radius: 0px;
	// border-bottom-right-radius: 0px;
`;

const BrowserNavBar = styled(Box)`
	display: flex;
	justify-content: space-between;
	align-items: center;
	padding: 8px;
	// background-color: #fafafa;
	border-bottom: 1px solid #e4e4e4;
	height: 58px;
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
	gap: 8px;
	height: 100%;
	padding: 8px;
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

const ActionsHud = styled(Box)`
	position: absolute;
	top: .5rem;
	right: .5rem;
	width: 100%;
	display: flex;
	justify-content: flex-end;
	pointer-events: none;
	& > div {
		border: 1px solid #e4e4e4;
		background-color: rgba(220, 220, 220, 0.70);
		backdrop-filter: blur(4px);
		border-radius: 5px;
		padding: 0.5rem 1rem;
		&:hover {
			opacity: 0.25;
		}
	}
`;

const Iframe = styled('iframe')`
		width: 100%;
		height: 100%;
		border: none;
		background-color: #fff;
`;

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

	useEffect(() => {
		urlRef.current = url;
	}, [url]);

	useEffect(() => {
		backlogRef.current = mutationBacklog;
	}, [mutationBacklog]);


	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Meta') {
			setMetaPressed(true);
		} else if (e.key === 'Shift') {
			setShiftPressed(true);
		}
	};
	const handleKeyUp = (e: KeyboardEvent) => {
		if (e.key === 'Meta') {
			setMetaPressed(false);
		} else if (e.key === 'Shift') {
			setShiftPressed(false);
		}
	};

	useEffect(() => {
		// if cmd button is pressed
		document.addEventListener('keydown', handleKeyDown);
		document.addEventListener('keyup', handleKeyUp);
		return () => {
			document.removeEventListener('keydown', handleKeyDown);
			document.removeEventListener('keyup', handleKeyUp);
		};
	}, [setMetaPressed, setShiftPressed]);

	useEffect(() => {
		const setup = async () => {
			const _socket = io('/', {
				query: {
					browserSessionId: 'test123',
				},
				transports: ['websocket'],
				reconnection: true,
				reconnectionAttempts: Infinity,
				reconnectionDelay: 5000,
				reconnectionDelayMax: 15000,
			});

			setSocket(_socket);

			_socket.on('pong', (start_t) => {
				const latency = Date.now() - start_t;
				setPing(latency);
			});

			_socket.on('connect', () => {
				console.log('Connected to server');
				_socket.emit('browser-update', { type: 'resize', data: { width: iframeRef.current.offsetWidth, height: iframeRef.current.offsetHeight } });
				_socket.emit('browser-update', { type: 'scroll', data: { x: iframeRef.current.scrollLeft, y: iframeRef.current.scrollTop } });
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
					if (iframeRef.current) {
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
				let element = iframeRef.current?.contentDocument?.querySelector(`[shinpads-id="${data.shinpadsId}"]`);
				if (data.shinpadsId === 0) {
					element = iframeRef.current?.contentDocument?.body.parentElement;
				}
				if (!element) {
					console.error('element not found', data, iframeRef.current?.contentDocument?.body.cloneNode(true));
					return;
				}
				if (data.type === 'childList') {
					const nextSibling = data.nextSibling ? iframeRef.current?.contentDocument?.querySelector(`[shinpads-id="${data.nextSibling}"]`) : null;
					const previousSibling = data.previousSibling ? iframeRef.current?.contentDocument?.querySelector(`[shinpads-id="${data.previousSibling}"]`) : null;
					data.addedNodes?.forEach((node) => {
						if (!node.shinpadsId && node.text) {
							element.textContent = node.text;
						} else {
							const existingElement = iframeRef.current?.contentDocument?.querySelector(`[shinpads-id="${node.shinpadsId}"]`);
							if (existingElement) {
								existingElement.remove();
							}

							if (!node) return;

							const nodeElement = addNodeFromJson(element, node.node, iframeRef.current?.contentDocument);
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
					console.log('add-style', element);
					const sheet = (element as HTMLStyleElement).sheet;
					sheet.insertRule(data.rule, sheet.cssRules.length);
				} else if (data.type === 'remove-style') {
					const sheet = (element as HTMLStyleElement).sheet;
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
		socket.emit('browser-update', { type: 'navigate', data: parsedUrl });
	};

	const onGoBack = () => {
		socket.emit('browser-update', { type: 'go-back' });
	};

	const onGoForward = () => {
		socket.emit('browser-update', { type: 'go-forward' });
	};

	const onReload = () => {
		socket.emit('browser-update', { type: 'reload' });
	};

	const onBrowserUpdate = (update: any) => {
		socket.emit('browser-update', update);
	};


	return (
		<PageContainer>
			<PageContentContainer>
				{/* <ShinpadsBuilder /> */}
				<BrowserContainer boxShadow='md'>
					<BrowserNavBar>
						{/* <Box display='flex' marginRight={1} marginLeft={0.5} alignItems='center'>
							<LogoIcon style={{ borderRadius: '4px' }} width={28} height={28} />
						</Box> */}
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
