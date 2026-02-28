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
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				const numStr = syncVaultNotes(this.app).then((n) => n.toString());
				numStr.then(
					(n) => new Notice(n),
					(e) => console.error(e),
				);
			},
		);

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "sync-cards",
			name: "Sync cards",
			callback: async () => {
				const added = await syncVaultNotes(this.app);
				new Notice(`Synced flashcards. Added ${added} note${added === 1 ? "" : "s"}.`);
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
}
