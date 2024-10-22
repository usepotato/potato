
export function getElementData(element, includeText = true) {
	if (!element) return null;

	const attributes = {};
	for (const attribute of element.attributes) {
		attributes[attribute.name] = attribute.value;
	}

	return {
		id: element.id,
		text: includeText ? element.innerText : '',
		attributes: attributes,
		tagName: element.tagName,
		classList: Array.from(element.classList),
		parent: (element.tagName !== 'BODY' && element.parentElement) ? getElementData(element.parentElement, false) : null
	};
}

export function getElementsFromData(doc, elementData) {
	if (!elementData) return [];
	// todo: will have to reference the stack in some way
	const stack = [];
	let current = elementData;
	while (current) {
		stack.unshift(current);
		current = current.parent;
	}
	const query = stack.map((el) => buildElementQuery(el)).join(' > ');
	const elements = doc.querySelectorAll(query);
	return Array.from(elements);
}

function escapeSpecialChars(text) {
	// put double backslash infront of : or [ or ] or % or # or / or @ or . or & or = or + or ,
	if (!text) return text;
	return text.replaceAll(/[:[\]%#/@.&=+,-!]/g, '\\$&');
}

function buildElementQuery(element, includeId = false) {
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
