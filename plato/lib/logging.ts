import debug from 'debug';

const getLogger = (namespace: string) => {
	return {
		// eslint-disable-next-line
		debug: (...args: any[]) => debug('plato:' + namespace + ':debug')(...(args as [string, ...any[]])),
		// eslint-disable-next-line
		log: (...args: any[]) => debug('plato:' + namespace + ':log')(...(args as [string, ...any[]])),
		// eslint-disable-next-line
		info: (...args: any[]) => debug('plato:' + namespace + ':info')(...(args as [string, ...any[]])),
		// eslint-disable-next-line
		warn: (...args: any[]) => debug('plato:' + namespace + ':warn')(...(args as [string, ...any[]])),
		// eslint-disable-next-line
		error: (...args: any[]) => debug('plato:' + namespace + ':error')(...(args as [string, ...any[]])),
	};
};

export default getLogger;
