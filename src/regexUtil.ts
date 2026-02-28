
export const FLASHCARD_PATTERN: RegExp = /\[!flashcard\]\s*([^\n]*)\n((?:>(?:[^\n]*)\n?)*)/;

export function splitCalloutBody(body: string) {
	const lines =  body.split(">");
	return lines.join("<br>");
}
