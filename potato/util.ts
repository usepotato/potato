// eslint-disable-next-line
function generateStack(elementData: Record<string, any>): any[] {
	const stack = [];
	let current = elementData;
	while (current) {
		stack.unshift(current);
		current = current.parent;
	}
	return stack;
}

// eslint-disable-next-line
export function buildQueryFromElementData(elementData: Record<string, any>): string {
	const stack = generateStack(elementData);
	return `:scope > ${stack.join(' > ')}`;
}
