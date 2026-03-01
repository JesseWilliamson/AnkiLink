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

		// This creates an icon in the left ribbon.
		this.addRibbonIcon(
			"circle-question-mark",
			"Sample",
			async (_evt: MouseEvent) => {
				await this.runSyncAndNotify();
			},
		);

		// This adds a simple command that can be triggered anywhere
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

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new AnkiLinkSettingsTab(this.app, this));
	}

	onunload() {
		// Put unload code here
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
		try {
			const { added, modified, deleted } = await syncVaultNotes(this.app);
			new Notice(
				`Synced flashcards.\nAdded ${added} card${added === 1 ? "" : "s"},\nmodified ${modified} card${modified === 1 ? "" : "s"},\ndeleted ${deleted} card${deleted === 1 ? "" : "s"}.`,
			);
		} catch (error) {
			console.error(error);
			// TODO: Provide the user with a more helpful error message.
			new Notice("Failed to sync flashcards. Check console for details.");
		}
	}
}
