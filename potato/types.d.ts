export interface WebAction {
	id: string;
	type: string;
	url?: string;
	parameter: Record<string, string>;
	element: Record<string, string>;
	subActions: WebAction[];
	attribute: string | null;
	filters: Record<string, string>[];
}
