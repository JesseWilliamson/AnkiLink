
export const FLASHCARD_PATTERN: RegExp = /\[!flashcard\]\s*([^\n]*)\n((?:>(?:[^\n]*)\n?)*)/;

export function splitCalloutBody(body: string) {
	const lines =  body.split(">");
	lines.shift(); // All bodies will start with a > and a space
	return lines.join("<br>");
}
