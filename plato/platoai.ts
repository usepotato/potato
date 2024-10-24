import getLogger from '@lib/logging';
import type { Page } from 'puppeteer';
import fs from 'fs';
import sharp from 'sharp';
import openai from '@lib/openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';
import type { WebAction } from 'types';
import { NodeHtmlMarkdown, NodeHtmlMarkdownOptions } from 'node-html-markdown';


const logger = getLogger('platoai');

class PlatoAI {
	static async act(page: Page, action: string, onUpdate: (update: any) => void) {
		logger.info('act', action);
		const boxAnnotations = await page.evaluate(() => window.getBoxAnnotations(document.body, null));
		const annotations = boxAnnotations.subAnnotations;

		await screenShotWithAnnotations(page, annotations);

		onUpdate({
			type: 'considered-elements',
			data: annotations.map(annotation =>
				annotation.annotation.id,
			),
		});

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

	static async extract(elementHtml: string, action: WebAction, onUpdate: (update: any) => void) {
		try {
		// TODO: clean up the html a lot

			const markdown = await NodeHtmlMarkdown.translate(elementHtml, { keepDataImages: true });

			// first build schema based on subActions of the action.
			const schema = buildSchema(action);

			if (!markdown) {
			// return empty object based on schema
				return {};
			}

			logger.info('calling openai to extract', markdown);

			const response = await openai.chat.completions.create({
				model: 'gpt-4o',
				messages: [
					{
						role: 'system',
						content: 'Here is a component on a webpage in markdown format. Please extract the data from it according to the provided schema.',
					},
					{
						role: 'user',
						content: [
							{
								type: 'text',
								// text: 'email: robfarlow@gmail.com, location: San Francisco, CA',
								text: markdown,
							},
						],
					},
				],
				response_format: zodResponseFormat(schema, action.parameter.name),
			// response_format: zodResponseFormat(z.object({ email: z.string(), location: z.string() }), 'details'),
			});

			const result = JSON.parse(response.choices[0].message.content || '{}');
			return result;
		} catch (error) {
			logger.error('Error calling openai to extract', error);
			return null;
		}
	}

}

function buildSchema(action: WebAction) {
	if (['text', 'image', 'number', 'boolean'].includes(action.parameter.type)) {
		let type: z.ZodType = z.string().nullable();
		if (['text', 'image'].includes(action.parameter.type)) {
			type = z.string().nullable();
		} else if (action.parameter.type === 'number') {
			type = z.number().nullable();
		} else if (action.parameter.type === 'boolean') {
			type = z.boolean().nullable();
		}
		if (action.parameter.isArray) {
			return z.array(type);
		} else {
			return type;
		}
	}

	const schema: Record<string, z.ZodType> = {};

	for (const subAction of action.subActions) {
		schema[subAction.parameter.name] = buildSchema(subAction);
	}
	return z.object(schema);
}

async function buildActOptions(page: Page, annotations: any) {
	// screenshot each anotation, describe it with LLM, return it as option with unique ID
	const fullScreenshot = await page.screenshot({ encoding: 'binary' });

	const options = await Promise.all(annotations.map(async (annotation: any, index: number) => {
		const screenshot = await screenShotAnnotation(fullScreenshot, annotation);
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'text',
							text: 'Here is a component on a webpage. Please describe it as simply as possible while still being descriptive. For example: "A yellow button with text "Submit" and a star icon on the right side."',
						},
						{
							type: 'image_url',
							image_url: {
								url: screenshot,
							},
						},
						{
							type: 'text',
							text: `The component is a ${annotation.tagName} element.`,
						},
					],
				},
			],
		});

		const description = response.choices[0].message.content;

		return { id: index, shinpadsId: annotation.annotation.id, description, screenshot };
	}));

	// save screenshots to file for debugging
	fs.writeFileSync('tmp/annotations.md', '# Annotations\n\n' + options.map(option => `![${option.description}](${option.screenshot})\n<br/>${option.description}\n`).join('\n'));

	return options;
}

async function screenShotAnnotation(screenshot: Uint8Array, annotation: any) {
	// crop just the annotation
	const { x, y, width, height } = annotation.annotation.rect;
	let sharpImage = sharp(screenshot);
	const metadata = await sharpImage.metadata();
	if (!metadata.width || !metadata.height) {
		throw new Error('No metadata');
	}
	const left = Math.max(Math.floor(x) - 2, 0);
	const top = Math.max(Math.floor(y) - 2, 0);
	const extractWidth = Math.min(Math.ceil(width) + 4, metadata.width - left);
	const extractHeight = Math.min(Math.ceil(height) + 4, metadata.height - top);
	sharpImage = sharpImage.extract({ left, top, width: extractWidth, height: extractHeight });
	// down sample the image to half the original resolution
	sharpImage = sharpImage.resize({ width: Math.ceil(extractWidth / 1.5), height: Math.ceil(extractHeight / 1.5) });
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
	fs.writeFileSync('tmp/annotatedBoxAnnotations.png', annotatedScreenshot);
}

export default PlatoAI;
