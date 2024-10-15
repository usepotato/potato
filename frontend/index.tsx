// import 'core-js/stable';
import React from 'react';
import './public/index.css';
import { createRoot } from 'react-dom/client';
// import { joyTheme, muiTheme } from '@/src/styles/theme';
import { CssVarsProvider as JoyCssVarsProvider } from '@mui/joy/styles';
// import CssBaseline from '@mui/material/CssBaseline';
// import {
// 	experimental_extendTheme as materialExtendTheme,
// 	Experimental_CssVarsProvider as MaterialCssVarsProvider,
// 	THEME_ID as MATERIAL_THEME_ID,
// } from '@mui/material/styles';

import App from './App';

const container = document.getElementById('root');

if (!container) {
	throw new Error('No root element found');
}


const root = createRoot(container);
// const materialTheme = materialExtendTheme(muiTheme);

root.render((
	<JoyCssVarsProvider>
		<App />
	</JoyCssVarsProvider>
));
