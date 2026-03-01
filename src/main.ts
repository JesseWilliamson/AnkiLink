import { Editor, Notice, Plugin } from "obsidian";
import {
	DEFAULT_SETTINGS,
	AnkiLinkSettings,
	AnkiLinkSettingsTab,
} from "./settings";
import { syncVaultNotes } from "./syncUtil";

export default class AnkiLink extends Plugin {
	settings!: AnkiLinkSettings;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon(
			"circle-question-mark",
			"Sample",
			async (_evt: MouseEvent) => {
				await this.runSyncAndNotify();
			},
		);

		this.addCommand({
			id: "sync-cards",
			name: "Sync cards",
			callback: async () => {
				await this.runSyncAndNotify();
			},
		});

		this.addCommand({
			id: "add-flashcard",
			name: "Add flashcard",
			editorCallback: (editor: Editor) => {
				this.insertFlashcard(editor);
			},
		});

		this.addSettingTab(new AnkiLinkSettingsTab(this.app, this));
	}

	async loadSettings() {
		this.settings = {
			...DEFAULT_SETTINGS,
			...((await this.loadData()) as Partial<AnkiLinkSettings>),
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private insertFlashcard(editor: Editor) {
		const template = "> [!flashcard] ";
		editor.replaceSelection(template);
	}

	private async runSyncAndNotify(): Promise<void> {
		const syncingNotice = new Notice("Syncing flashcards", 0);
		const spinnerFrames = [
			"⠋",
			"⠙",
			"⠹",
			"⠸",
			"⠼",
			"⠴",
			"⠦",
			"⠧",
			"⠇",
			"⠏",
		];
		let spinnerFrameIndex = 0;
		const spinnerIntervalId = globalThis.setInterval(() => {
			const spinner = spinnerFrames[spinnerFrameIndex % spinnerFrames.length]!;
			syncingNotice.setMessage(`${spinner} Syncing flashcards`);
			spinnerFrameIndex += 1;
		}, 90);
		try {
			const { added, modified, deleted } = await syncVaultNotes(this.app);
			globalThis.clearInterval(spinnerIntervalId);
			syncingNotice.hide();
			new Notice(
				`Synced flashcards.\nAdded ${added} card${added === 1 ? "" : "s"},\nmodified ${modified} card${modified === 1 ? "" : "s"},\ndeleted ${deleted} card${deleted === 1 ? "" : "s"}.`,
			);
		} catch (error) {
			globalThis.clearInterval(spinnerIntervalId);
			syncingNotice.hide();
			console.error(error);
			new Notice(`Failed to sync flashcards: ${this.getErrorMessage(error)}`);
		}
	}

	private getErrorMessage(error: unknown): string {
		if (error instanceof Error && error.message) {
			return error.message;
		}

		if (typeof error === "string" && error.trim().length > 0) {
			return error;
		}

		return "Unknown error";
	}
}
