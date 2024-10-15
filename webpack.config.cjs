require('dotenv').config({ path: `./.env.${process.env.NODE_ENV}` });
const webpack = require('webpack');
const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const outputDirectory = 'dist';

module.exports = (env, argv) => ({
	entry: ['./frontend/index.tsx'],
	output: {
		path: path.join(__dirname, outputDirectory),
		publicPath: '/',
		filename: 'potato/bundle.js',
	},
	// devtool: argv.mode === 'development' ? 'eval-source-map' : 'source-map',
	devtool: argv.mode === 'development' ? 'eval-source-map' : 'source-map',
	performance: {
		hints: false,
		maxEntrypointSize: 512000,
		maxAssetSize: 512000,
	},
	module: {
		rules: [
			{
				test: /\.m?js/,
				resolve: {
					fullySpecified: false,
				},
			},
			{
				test: /\.m?js$/,
				enforce: 'pre',
				use: ['source-map-loader'],
				exclude: /node_modules/,
			},
			{
				test: /\.(ts|tsx)$/,
				use: [
					{
						loader: 'ts-loader',
						options: {
							transpileOnly: true,
							experimentalWatchApi: true,
						},
					},
				],
				exclude: /node_modules/,
			},
			{
				test: /\.css$/,
				use: ['style-loader', 'css-loader'],
			},
			{
				test: /\.svg$/,
				use: ['@svgr/webpack', 'file-loader'],
			},
		],
	},
	resolve: {
		extensions: ['.*', '.js', '.jsx', '.tsx', '.ts'],
		alias: {
			'@': path.resolve(__dirname, './frontend'),
			'@public': path.resolve(__dirname, './frontend/public'),
		},
		modules: [path.resolve(__dirname, 'frontend'), 'node_modules'],
	},
	optimization: {
		removeAvailableModules: false,
		removeEmptyChunks: false,
		splitChunks: false,
	},
	plugins: [
		new HtmlWebpackPlugin({
			template: './frontend/public/index.html',
			filename: 'potato/index.html',
			publicPath: '/',
			minify: argv.mode === 'production' ? {
				removeComments: true,
				collapseWhitespace: true,
				removeRedundantAttributes: true,
				useShortDoctype: true,
				removeEmptyAttributes: true,
				removeStyleLinkTypeAttributes: true,
				keepClosingSlash: true,
				minifyJS: true,
				minifyCSS: true,
				minifyURLs: true,
			} : undefined,
		}),
		new webpack.DefinePlugin({
			ENVIRONMENT: JSON.stringify(argv.mode),
		}),
		new webpack.IgnorePlugin({
			resourceRegExp: /^\.\/locale$/,
			contextRegExp: /moment$/,
		}),
	],
});
