// @ts-nocheck
export function getElementData(element, includeText = true) {
	const attributes = {};
	for (const attribute of element.attributes) {
		attributes[attribute.name] = attribute.value;
	}

	return {
		id: element.id,
		text: includeText ? element.innerText : '',
		attributes: attributes,
		shinpadsId: element.getAttribute('shinpads-id'),
		tagName: element.tagName,
		classList: Array.from(element.classList),
		parent: (element.tagName !== 'BODY' && element.parentElement) ? getElementData(element.parentElement, false) : null
	};
}

export function getElementsFromData(parentEl, elementData) {
	try {
		if (!elementData) return [];
		// todo: will have to reference the stack in some way
		const stack = [];
		let current = elementData;
		while (current && current.shinpadsId !== parentEl.getAttribute?.('shinpads-id')) {
			stack.unshift(current);
			current = current.parent;
		}
		const query = stack.map((el) => buildElementQuery(el)).join(' > ');
		const elements = parentEl.querySelectorAll(query);
		return Array.from(elements);
	} catch (e) {
		console.warn('error getting elements from data', e);
		return [];
	}
}

export function escapeSpecialChars(text) {
	// put double backslash infront of : or [ or ] or % or # or / or @ or . or & or = or + or ,
	if (!text) return text;
	// replace - but only if its right after a .
	text = text.replaceAll(/([.])-/g, '$1\\-');
	return text.replaceAll(/[:[\]%#/@.&=+,!()]/g, '\\$&');
}

export function buildElementQuery(element, includeId = false) {
	if (['HTML', 'BODY', 'HEAD'].includes(element.tagName)) {
		return element.tagName;
	}
	const classList = Array.from(element.classList || []);
	const idQuery = element.id ? `#${escapeSpecialChars(element.id)}` : '';
	const classQuery = classList.map(c => `.${escapeSpecialChars(c)}`).join('');
	return `${element.tagName}${includeId ? idQuery : ''}${classQuery}`;
}

export function buildLowestListParent(doc, element) {
	// starting with element parent, go up the dom tree and find the first parent that contains more than 1 child
	let current = element.parentElement;
	let prev = element;
	let query = buildElementQuery(element);
	while (current && current.tagName !== 'HTML') {
		const subList = current.querySelectorAll(`:scope > ${query}`);
		if (subList.length > 1) {
			const allListParents = getElementsFromData(doc, getElementData(current, true));
			const listParents = allListParents.filter(el => el.querySelectorAll(`:scope > ${query}`).length > 0);
			return {
				listElement: current,
				allListElements: listParents,
				nonListContextElement: prev,
			};
		}
		// query = `${current.tagName}${current.classList[0] ? '.' + escapeSpecialChars(current.classList[0]) : ''} > ${query}`;
		query = buildElementQuery(current) + ' > ' + query;
		prev = current;
		current = current.parentElement;
	}
	return {
		listElement: null,
		allListElements: [],
	};
}

export function buildListParent(element, listParent) {
	const stack = [];
	let current = element;
	while (current && current !== listParent) {
		stack.unshift(getElementData(current));
		current = current.parentElement;
	}
	return {
		listElement: current,
		stack,
	};
}

export function getMatchingListItemsFromStack(listElement, stack) {
	// TODO: ideally it would do some type of search where it starts really strict but if there is no list then it loosens restrictions in the best way to get a list
	// highlighting specific children in a list item
	let currentListStack = stack;
	let index = 1;
	let result = [];
	while (index <= currentListStack.length) {
		const lastFromIndex = currentListStack.slice(0, index);
		const query = `:scope > ${lastFromIndex.map((el) => buildElementQuery(el)).join(' > ')}`;
		console.log('query', query);
		const list = listElement.querySelectorAll(query);
		console.log('list', list);
		if (list.length > 0) {
			result = Array.from(list);
			index++;
		} else {
			currentListStack = currentListStack.slice(0, index - 1);
			break;
			// todo: try other variations of class names etc
		}
	}
	return {
		items: result,
		stack: currentListStack,
	};
}

export async function getBase64FromUrl(url) {
	try {
		const data = await fetch(url);
		const blob = await data.blob();

		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.readAsDataURL(blob);
			reader.onloadend = () => resolve(reader.result);
			reader.onerror = (err) => reject(err);
		});
	} catch (e) {
		console.warn('error getting base64 from url', e);
		return null;
	}
};

// script to get box outlines for all visible dom elements
// if parent is simply a container, then use the width and height of the parent for the child and combine them.
// if the element is clickable, then don't recurse into it. anymore.
function isElementVisible(element) {
	if (!(element instanceof Element)) {
		throw new Error('Element expected');
	}

	const style = getComputedStyle(element);

	if (style.display === 'contents') {
		return true; // maybe change? idk this is probably right
	}

	// Check for display, visibility, and opacity
	if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
		return false;
	}

	const rect = element.getBoundingClientRect();
	// add translate to the rect
	const transform = style.transform;
	if (transform.includes('translate')) {
		return true;
	}

	// Check if the element is in the viewport
	if (
		rect.width === 0 ||
    rect.height === 0 ||
    ( rect.top < 0 && rect.bottom < 0 ) ||
    ( rect.top > window.innerHeight && rect.bottom > window.innerHeight ) ||
    ( rect.left < 0 && rect.right < 0 ) ||
    ( rect.left > window.innerWidth && rect.right > window.innerWidth )
	) {
		return false;
	}

	// Check if any of the ancestors hide the element with overflow
	let currentElement = element;

	while (currentElement) {
		const currentStyle = getComputedStyle(currentElement);

		if (currentStyle.overflow === 'hidden' || currentStyle.overflow === 'auto' || currentStyle.overflow === 'scroll') {
			const parentRect = currentElement.getBoundingClientRect();

			if (
				rect.bottom < parentRect.top ||
        rect.top > parentRect.bottom ||
        rect.right < parentRect.left ||
        rect.left > parentRect.right
			) {
				return false;
			}
		}

		currentElement = currentElement.parentElement;
	}

	return true;
}


function isClickable(element) {
	const computedStyle = getComputedStyle(element);
	if (computedStyle.cursor === 'pointer' || computedStyle.cursor === 'text') {
		return true;
	}

	// Check if the element is a button or a link
	if (element.tagName === 'BUTTON' || element.tagName === 'A') {
		return true;
	}

	// Check if any class applied to the element sets cursor: pointer
	const elementClasses = element.classList;
	for (let i = 0; i < elementClasses.length; i++) {
		const className = elementClasses[i];
		// Create a dummy element to check the style of the class
		const dummyElement = document.createElement('div');
		dummyElement.className = className;
		document.body.appendChild(dummyElement);
		if (getComputedStyle(dummyElement).cursor === 'pointer') {
			document.body.removeChild(dummyElement);
			return true;
		}
		document.body.removeChild(dummyElement);
	}

	return false;
}

function getBoxAnnotations(element, parent, mustBeClickable=true) {
	if (!isElementVisible(element) || element.tagName === 'svg') {
		return {
			annotation: null,
			subAnnotations: [],
			numChildren: 0,
			numClickableChildren: 0,
		};
	}

	let rect = element.getBoundingClientRect();
	let annotation = null;
	const subAnnotations = [];
	const clickable = isClickable(element);

	if (rect.width > 3 && rect.height > 3 && (element.children.length > 1 || element.shadowRoow?.children?.length > 1 || clickable)) {
		// bind rect to screen view dimensions
		rect = {
			y: Math.max(rect.top, 0),
			x: Math.max(rect.left, 0),
			width: Math.min(rect.width, window.innerWidth - rect.left),
			height: Math.min(rect.height, window.innerHeight - rect.top),
		};


		if (clickable) {
			annotation = {
				type: 'clickable',
				rect,
				id: element.getAttribute('shinpads-id'),
				tagName: element.tagName,
			};
		} else if (!mustBeClickable) {
			annotation = {
				type: 'box',
				rect,
				id: element.getAttribute('shinpads-id'),
				tagName: element.tagName,
			};
		}
	}


	if (element.shadowRoot) {
		for (let i = 0; i < element.shadowRoot.children.length; i++) {
			const child = element.shadowRoot.children[i];
			const subAnnotation = getBoxAnnotations(child, element, mustBeClickable || clickable);
			if (!subAnnotation.annotation) {
				subAnnotations.push(...subAnnotation.subAnnotations);
			} else {
				subAnnotations.push(subAnnotation);
			}
		}
	}

	for (let i = 0; i < element.children.length; i++) {
		const child = element.children[i];
		const subAnnotation = getBoxAnnotations(child, element, mustBeClickable || clickable);
		if (!subAnnotation.annotation) {
			subAnnotations.push(...subAnnotation.subAnnotations);
		} else {
			subAnnotations.push(subAnnotation);
		}
	}
	if (!subAnnotations.length && !clickable) {
		return {
			annotation: null,
			subAnnotations: [],
			numChildren: 0,
			numClickableChildren: 0,
		};
	}

	if (subAnnotations.length === 1 && !clickable) {
		return subAnnotations[0];
	}

	return {
		annotation,
		subAnnotations,
		numChildren: subAnnotations.reduce((acc, subAnnotation) => acc + subAnnotation.numChildren + 1, 0),
		numClickableChildren: subAnnotations.reduce((acc, subAnnotation) => acc + subAnnotation.numClickableChildren + (subAnnotation.annotation?.type === 'clickable' ? 1 : 0), 0),
	};
}


export function injectScript() {
	return `
	window.escapeSpecialChars = ${escapeSpecialChars.toString()};
	window.getMatchingListItemsFromStack = ${getMatchingListItemsFromStack.toString()};
	window.buildLowestListParent = ${buildLowestListParent.toString()};
	window.buildListParent = ${buildListParent.toString()};
	window.getElementsFromData = ${getElementsFromData.toString()};
	window.getElementData = ${getElementData.toString()};
	window.buildElementQuery = ${buildElementQuery.toString()};
	window.isElementVisible = ${isElementVisible.toString()};
	window.isClickable = ${isClickable.toString()};
	window.getBoxAnnotations = ${getBoxAnnotations.toString()};
	`;
}

