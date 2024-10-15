import debug from 'debug';

const getLogger = (namespace: string) => {
	return {
		// eslint-disable-next-line
		debug: (...args: any[]) => debug('potato:' + namespace + ':debug')(...(args as [string, ...any[]])),
		// eslint-disable-next-line
		log: (...args: any[]) => debug('potato:' + namespace + ':log')(...(args as [string, ...any[]])),
		// eslint-disable-next-line
		error: (...args: any[]) => debug('potato:' + namespace + ':error')(...(args as [string, ...any[]])),
	};
};

export default getLogger;
