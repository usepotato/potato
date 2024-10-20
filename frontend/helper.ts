export interface ElementData {
  id: string;
  text: string;
  attributes: Record<string, string>;
  tagName: string;
  classList: string[];
  parent: ElementData | null;
}

export const Events = {
	ON_ELEMENT_SELECTED: 'ON_ELEMENT_SELECTED',
	ON_CREATE_ACTION: 'ON_CREATE_ACTION',
	SUB_ACTION_ADDED: 'SUB_ACTION_ADDED',
	ON_FRAME_NAVIGATED: 'ON_FRAME_NAVIGATED',
};


export interface ElementData {
  id: string;
  text: string;
  attributes: Record<string, string>;
  tagName: string;
  classList: string[];
  parent: ElementData | null;
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
