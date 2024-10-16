export interface ElementData {
  id: string;
  text: string;
  attributes: Record<string, string>;
  tagName: string;
  classList: string[];
  parent: ElementData | null;
}

// eslint-disable-next-line
export function buildQueryFromElementData(elementData: Record<string, any>): string | null {
	if (!elementData) return null;
	// todo: will have to reference the stack in some way
	const stack = [];
	let current = elementData;
	while (current) {
		stack.unshift(current);
		current = current.parent;
	}
	const query = stack.map((el) => buildElementQuery(el)).join(' > ');
	return query;
}

function escapeSpecialChars(text: string) {
	// put double backslash infront of : or [ or ] or % or # or / or @ or . or &
	if (!text) return text;
	return text.replaceAll(/[:[\]%#/@.&]/g, '\\$&');
}

function buildElementQuery(element: ElementData, includeId: boolean = false) {
	if (['HTML', 'BODY', 'HEAD'].includes(element.tagName)) {
		return element.tagName;
	}
	const classList = Array.from(element.classList || []);
	const idQuery = element.id ? `#${escapeSpecialChars(element.id)}` : '';
	const classQuery = classList.map(c => `.${escapeSpecialChars(c)}`).join('');
	return `${element.tagName}${includeId ? idQuery : ''}${classQuery}`;
}

