import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_NOTE_COUNT = 500;
const DEFAULT_CARDS_PER_NOTE = 12;
const DEFAULT_TARGET_FOLDER = "anki-link-benchmark";
const DEFAULT_DECK_NAME = "Benchmark::Demo";

function parsePositiveInt(rawValue, fallbackValue) {
	if (rawValue == null) return fallbackValue;
	const parsed = Number.parseInt(rawValue, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Expected a positive integer but received "${rawValue}".`);
	}
	return parsed;
}

function parseArgs(argv) {
	const values = {
		notes: DEFAULT_NOTE_COUNT,
		cards: DEFAULT_CARDS_PER_NOTE,
		target: DEFAULT_TARGET_FOLDER,
		deck: DEFAULT_DECK_NAME,
	};

	for (const arg of argv) {
		if (arg === "--help" || arg === "-h") {
			values.help = true;
			continue;
		}

		const [key, rawValue] = arg.split("=");
		if (!rawValue) {
			throw new Error(`Invalid argument "${arg}". Use --key=value format.`);
		}

		if (key === "--notes") {
			values.notes = parsePositiveInt(rawValue, values.notes);
			continue;
		}
		if (key === "--cards") {
			values.cards = parsePositiveInt(rawValue, values.cards);
			continue;
		}
		if (key === "--target") {
			values.target = rawValue;
			continue;
		}
		if (key === "--deck") {
			values.deck = rawValue;
			continue;
		}

		throw new Error(`Unknown argument "${key}".`);
	}

	return values;
}

function getUsageText() {
	return [
		"Generate benchmark notes with demo flashcards.",
		"",
		"Usage:",
		"  npm run benchmark:notes -- --notes=800 --cards=20",
		"",
		"Options:",
		"  --notes=<number>   Number of markdown notes to generate (default: 500)",
		"  --cards=<number>   Flashcards per note (default: 12)",
		"  --target=<path>    Path relative to vault root (default: anki-link-benchmark)",
		"  --deck=<name>      Value for frontmatter key 'anki deck' (default: Benchmark::Demo)",
	].join("\n");
}

function buildFlashcardBlock(noteIndex, cardIndex) {
	const front = `Benchmark prompt ${noteIndex}-${cardIndex}: what does this card test?`;
	return [
		`> [!flashcard] ${front}`,
		`> This is demo answer ${noteIndex}-${cardIndex}.`,
		">",
		"> - Generated for sync/load testing",
		`> - Note ${noteIndex}, card ${cardIndex}`,
		">",
		"> ```text",
		`> token-${noteIndex}-${cardIndex}`,
		"> ```",
		"",
	].join("\n");
}

function buildNoteContent(noteIndex, cardsPerNote, deckName) {
	const header = [
		"---",
		`anki deck: ${deckName}`,
		"---",
		`# Benchmark note ${noteIndex}`,
		"",
	].join("\n");

	const cards = Array.from({ length: cardsPerNote }, (_, idx) => buildFlashcardBlock(noteIndex, idx + 1)).join("\n");
	return `${header}${cards}\n`;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log(getUsageText());
		return;
	}

	const thisFile = fileURLToPath(import.meta.url);
	const pluginDir = path.dirname(thisFile);
	const vaultRoot = path.resolve(pluginDir, "..", "..", "..");
	const outputDir = path.resolve(vaultRoot, options.target);

	await mkdir(outputDir, { recursive: true });

	for (let i = 1; i <= options.notes; i++) {
		const padded = String(i).padStart(4, "0");
		const filename = `benchmark-note-${padded}.md`;
		const notePath = path.join(outputDir, filename);
		const contents = buildNoteContent(i, options.cards, options.deck);
		await writeFile(notePath, contents, "utf8");
	}

	const totalCards = options.notes * options.cards;
	console.log(`Generated ${options.notes} notes with ${totalCards} flashcards.`);
	console.log(`Output directory: ${outputDir}`);
}

try {
	await main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.error(message);
	process.exitCode = 1;
}
