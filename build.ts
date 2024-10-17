await Bun.build({
	entrypoints: ['./frontend/index.tsx'],
	outdir: './dist/potato',
	minify: true,
	sourcemap: 'external',
	splitting: true,
	format: 'esm',
	footer: '// Built with ❤️ in SF'
});

import { promises as fs } from 'fs';
import path from 'path';

async function copyPublicFolder() {
	const source = './frontend/public';
	const destination = './dist/potato';

	await fs.mkdir(destination, { recursive: true });

	const entries = await fs.readdir(source, { withFileTypes: true });

	for (const entry of entries) {
		const srcPath = path.join(source, entry.name);
		const destPath = path.join(destination, entry.name);

		await fs.copyFile(srcPath, destPath);
	}
}

await copyPublicFolder();


export {};
