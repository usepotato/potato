import getLogger from '@lib/logging';
import type { Page } from 'puppeteer';
import fs from 'fs';
import sharp from 'sharp';
import openai from '@lib/openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';


const logger = getLogger('potatoai');

class PotatoAI {
	static async act(page: Page, action: string) {
		logger.info('act', action);
		const boxAnnotations = await page.evaluate(() => window.getBoxAnnotations(document.body, null));
		const annotations = boxAnnotations.subAnnotations;

		// await screenShotWithAnnotations(page, annotations);

		const options = await buildActOptions(page, annotations);
		logger.info('options', options);

		const screenshotRaw = await page.screenshot({ encoding: 'binary' });
		const screenshotBuffer = await sharp(screenshotRaw).toBuffer();
		const screenshot = `data:image/png;base64,${screenshotBuffer.toString('base64')}`;

		const bestOption = await openai.chat.completions.create({
			model: 'gpt-4o',
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: `Here is a web page. Please choose the best action to ${action}. Respond with the ID of the action you want to perform and nothing else.`,
						},
						{
							type: 'image_url',
							image_url: { url: screenshot },
						},
						{
							type: 'text',
							text: `Here are the options: ${options.map(option => `${option.id}: ${option.description}`).join('\n')}`,
						},
					],
				},
			],
			response_format: zodResponseFormat(
				z.object({
					id: z.number(),
				}),
				'action',
			),
		});

		const response = JSON.parse(bestOption.choices[0].message.content || '{}');
		if (!response.id) {
			return null;
		}

		const chosenOption = options.find(option => option.id === response.id);
		if (!chosenOption) {
			return null;
		}


		logger.info('chosenOption', chosenOption);

		return chosenOption.shinpadsId;

		// given a page and an action, find the best thing to click
		// first parse the page, and find all available actions
		// call LLM to determine which one to click
		// return the appropriate element


	}

	static async extract(page: Page, extraction: string) {
		// given a page and an extraction, find the best thing(s) to extract
		// similar to act, but need to find potentially many
	}

}

async function buildActOptions(page: Page, annotations: any) {
	// screenshot each anotation, describe it with LLM, return it as option with unique ID
	const options = await Promise.all(annotations.map(async (annotation: any, index: number) => {
		const screenshot = await screenShotAnnotation(page, annotation);
		const response = await openai.chat.completions.create({
			model: 'gpt-4o',
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Here is a component on a webpage. Please describe it as simply as possible while still being descriptive.',
						},
						{
							type: 'image_url',
							image_url: {
								url: screenshot,
							},
						},
					],
				},
			],
		});

		const description = response.choices[0].message.content;

		return { id: index, shinpadsId: annotation.annotation.id, description };
	}));
	return options;
}

async function screenShotAnnotation(page: Page, annotation: any) {
	const screenshot = await page.screenshot({ encoding: 'binary' });
	// crop just the annotation
	const { x, y, width, height } = annotation.annotation.rect;
	let sharpImage = sharp(screenshot);
	sharpImage = sharpImage.extract({ left: Math.floor(x), top: Math.floor(y), width: Math.ceil(width), height: Math.ceil(height) });
	// return base64 encoded url
	// like data:image/png;base64
	return sharpImage.toBuffer().then(buffer => `data:image/png;base64,${buffer.toString('base64')}`);
}

async function screenShotWithAnnotations(page: Page, annotations: any) {
	const screenshot = await page.screenshot({ encoding: 'binary' });

	// Use sharp to process the image
	let image = sharp(screenshot);

	// Draw annotations on the image
	const metadata = await image.metadata();
	const { width, height } = metadata;

	const overlay = Buffer.from(
		`<svg width="${width}" height="${height}">
      ${annotations.map(annotation => {
		if (annotation.annotation) {
			const { x, y, width, height } = annotation.annotation.rect;
			return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="red" stroke-width="2"/>`;
		}
		return '';
	}).join('')}
    </svg>`
	);

	image = image.composite([{ input: overlay, blend: 'over' }]);

	const annotatedScreenshot = await image.png().toBuffer();
	fs.writeFileSync('annotatedBoxAnnotations.png', annotatedScreenshot);
}

export default PotatoAI;
