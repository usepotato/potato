import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';


export default [
	{ files: ['**/*.{js,mjs,cjs,ts}'] },
	{ languageOptions: { globals: globals.browser } },
	pluginJs.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			semi: ['error', 'always'],
			indent: [2, 'tab'],
			'no-tabs': 0,
			'linebreak-style': ['error', 'unix'],
			quotes: ['error', 'single'],
			'comma-spacing': ['error', { before: false, after: true }],
			'no-multiple-empty-lines': ['error', { max: 2 }],
			'no-trailing-spaces': ['error'],
			'no-var': ['error'],
			'prefer-const': ['error'],
			'object-curly-spacing': ['error', 'always'],
			'arrow-spacing': ['error', { before: true, after: true }],
			'key-spacing': ['error', { beforeColon: false, afterColon: true }],
			'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
];
