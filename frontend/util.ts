export interface ElementData {
  id: string;
  text: string;
  attributes: Record<string, string>;
  tagName: string;
  classList: string[];
  parent: ElementData | null;
}


export interface ElementData {
  id: string;
  text: string;
  attributes: Record<string, string>;
  tagName: string;
  classList: string[];
  parent: ElementData | null;
}

export function getElementData(element: HTMLElement, includeText: boolean = true): ElementData {
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

export function getElementsFromData(doc: Document, elementData: ElementData) {
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
	return Array.from(elements) as HTMLElement[];
}

function escapeSpecialChars(text: string) {
	// put double backslash infront of : or [ or ] or % or # or / or @ or . or &
	if (!text) return text;
	return text.replaceAll(/[:[\]%#/@.&]/g, '\\$&');
}

function buildElementQuery(element: HTMLElement | ElementData, includeId: boolean = false) {
	if (['HTML', 'BODY', 'HEAD'].includes(element.tagName)) {
		return element.tagName;
	}
	const classList = Array.from(element.classList || []);
	const idQuery = element.id ? `#${escapeSpecialChars(element.id)}` : '';
	const classQuery = classList.map(c => `.${escapeSpecialChars(c)}`).join('');
	return `${element.tagName}${includeId ? idQuery : ''}${classQuery}`;
}

export function buildLowestListParent(doc: Document, element: HTMLElement) {
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

export function buildListParent(element: HTMLElement, listParent: HTMLElement) {
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

export function getMatchingListItemsFromStack(listElement: HTMLElement, stack: ElementData[]) {
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


export function appendIFrameStyle(doc: Document) {
	const style = doc.createElement('style');
	style.textContent = `
    .shinpads-highlight {
      background: rgba(137, 43, 226, 0.2);
      border: none;
      animation: rotate-dashes 5s linear infinite;
      border-radius: 4px;
      position: absolute;
      z-index: 1000000000;
      background-image:
        linear-gradient(90deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%),
        linear-gradient(90deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%);
      background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
      background-size: 6px 1px, 6px 1px, 1px 6px, 1px 6px;
      background-position: 0% 0%, 0% 100%, 0% 0%, 100% 0%;
    }

    .shinpads-highlight.secondary {
        background: rgba(163, 163, 163, 0.2);
        border: 1px dashed rgba(121, 121, 121, 0.85);
    }

    .shinpads-highlight.selected {
      background: rgba(137, 43, 226, 0.2);
      border: none;
      animation: rotate-dashes 5s linear infinite;
      background-image:
        linear-gradient(90deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%),
        linear-gradient(90deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(137, 43, 226, 0.85) 50%, transparent 50%);
      background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
      background-size: 6px 1px, 6px 1px, 1px 6px, 1px 6px;
      background-position: 0% 0%, 0% 100%, 0% 0%, 100% 0%;
    }

    .shinpads-highlight.active {
      background: rgba(0, 55, 255, 0.15);
      border: none;
      animation: rotate-dashes 5s linear infinite;
      background-image:
        linear-gradient(90deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%),
        linear-gradient(90deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%);
      background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
      background-size: 6px 2px, 6px 2px, 2px 6px, 2px 6px;
      background-position: 0% 0%, 0% 100%, 0% 0%, 100% 0%;
    }

    .shinpads-highlight.active-secondary {
      background: rgba(0, 55, 255, 0.15);
      border: 1px dashed rgba(0, 55, 255, 0.85);
      animation: none;
      background-image: none;
    }

    .shinpads-highlight.active-container {
      background: rgba(0, 55, 255, 0.05);
      border: none;
      animation: rotate-dashes 5s linear infinite;
      background-image:
        linear-gradient(90deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%),
        linear-gradient(90deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%),
        linear-gradient(0deg, rgba(0, 55, 255, 0.85) 50%, transparent 50%);
      background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
      background-size: 6px 2px, 6px 2px, 2px 6px, 2px 6px;
      background-position: 0% 0%, 0% 100%, 0% 0%, 100% 0%;
    }

    @keyframes rotate-dashes {
      to {
        background-position: 60px 0%, -60px 100%, 0% -60px, 100% 60px;
      }
    }

  `;
	doc.head.appendChild(style);
}
