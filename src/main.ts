import { Plugin, Notice, Editor, PluginSettingTab, App, Setting, FileSystemAdapter } from "obsidian";
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import * as path from "path";
import * as fs from "fs";
import which from "which";

const BINARY_NAME = "boofa-sketch";
const HOMEBREW_PATHS = [
	"/opt/homebrew/bin/boofa-sketch",
	"/usr/local/bin/boofa-sketch",
];
const SKETCH_TIMEOUT = 300_000; // 5 minutes

interface ContinuitySketchSettings {
	customBinaryPath: string;
}

const DEFAULT_SETTINGS: ContinuitySketchSettings = {
	customBinaryPath: "",
};

interface SketchResult {
	status: "done" | "cancelled" | "error";
	png?: string;
	width?: number;
	height?: number;
}

export default class ContinuitySketchPlugin extends Plugin {
	settings!: ContinuitySketchSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		if (process.platform !== "darwin") {
			console.warn("Continuity Sketch: this plugin only works on macOS");
			return;
		}

		this.addCommand({
			id: "add-sketch",
			name: "Add sketch from iPad",
			editorCallback: (editor: Editor) => this.addSketch(editor),
		});

		this.addSettingTab(new ContinuitySketchSettingTab(this.app, this));
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async findBinary(): Promise<string | null> {
		// 1. Custom path from settings
		if (this.settings.customBinaryPath) {
			try {
				await fs.promises.access(this.settings.customBinaryPath, fs.constants.X_OK);
				return this.settings.customBinaryPath;
			} catch {
				return null;
			}
		}

		// 2. which (PATH lookup)
		const found = await which(BINARY_NAME, { nothrow: true });
		if (found) return found;

		// 3. Homebrew fallback paths
		for (const p of HOMEBREW_PATHS) {
			try {
				await fs.promises.access(p, fs.constants.X_OK);
				return p;
			} catch {
				continue;
			}
		}

		return null;
	}

	private getOutputDir(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("FileSystemAdapter required");
		}
		const vaultPath = adapter.getBasePath();
		const attachmentFolder: string =
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(this.app.vault as any).getConfig("attachmentFolderPath") ?? "";

		if (attachmentFolder.startsWith("./")) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				const parentDir = activeFile.parent?.path ?? "";
				const relFolder = attachmentFolder.slice(2);
				return path.join(vaultPath, parentDir, relFolder);
			}
		}

		return path.join(vaultPath, attachmentFolder);
	}

	private formatImageEmbed(filename: string): string {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const useMarkdownLinks = (this.app.vault as any).getConfig("useMarkdownLinks");
		if (useMarkdownLinks) {
			return `![sketch](${encodeURI(filename)})`;
		}
		return `![[${filename}]]`;
	}

	private async addSketch(editor: Editor): Promise<void> {
		const binaryPath = await this.findBinary();
		if (!binaryPath) {
			new Notice(
				"boofa-sketch not found.\nInstall with: brew install wasmir/tap/boofa-sketch\nhttps://github.com/wasmir/boofa-sketch",
				10_000,
			);
			return;
		}

		let outputDir: string;
		try {
			outputDir = this.getOutputDir();
			await fs.promises.mkdir(outputDir, { recursive: true });
		} catch (e) {
			new Notice("Failed to determine attachment folder: " + String(e));
			return;
		}

		const drawingId = randomUUID();
		new Notice("Waiting for sketch from iPad…", 5_000);

		let result: SketchResult;
		try {
			result = await new Promise<SketchResult>((resolve, reject) => {
				execFile(
					binaryPath,
					["--output-dir", outputDir, "--drawing-id", drawingId],
					{ timeout: SKETCH_TIMEOUT, maxBuffer: 1024 * 1024 },
					(error, stdout, stderr) => {
						if (error) {
							if (error.killed) {
								resolve({ status: "cancelled" });
							} else {
								reject(new Error(
									`boofa-sketch failed: ${error.message}` +
									(stderr ? `\nstderr: ${stderr}` : ""),
								));
							}
							return;
						}
						try {
							resolve(JSON.parse(stdout.trim()));
						} catch {
							reject(new Error(
								`Failed to parse boofa-sketch output: ${stdout}`,
							));
						}
					},
				);
			});
		} catch (e) {
			new Notice("Sketch failed: " + String(e), 8_000);
			return;
		}

		if (result.status === "done" && result.png) {
			const adapter = this.app.vault.adapter;
			if (!(adapter instanceof FileSystemAdapter)) return;
			const vaultPath = adapter.getBasePath();
			const absoluteImgPath = path.join(outputDir, result.png);
			const vaultRelativePath = path.relative(vaultPath, absoluteImgPath);

			const embed = this.formatImageEmbed(vaultRelativePath);
			editor.replaceSelection(embed + "\n");
			new Notice("Sketch inserted!");
		} else if (result.status === "cancelled") {
			new Notice("Sketch cancelled.");
		} else {
			new Notice("Sketch failed with unknown status: " + result.status);
		}
	}
}

class ContinuitySketchSettingTab extends PluginSettingTab {
	plugin: ContinuitySketchPlugin;

	constructor(app: App, plugin: ContinuitySketchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		if (process.platform !== "darwin") {
			containerEl.createEl("p", {
				text: "This plugin only works on macOS and requires the boofa-sketch helper.",
				cls: "mod-warning",
			});
		}

		new Setting(containerEl)
			.setName("Custom binary path")
			.setDesc(
				"Override the auto-detected path to boofa-sketch. " +
				"Leave empty to auto-detect from PATH and Homebrew locations.",
			)
			.addText((text) =>
				text
					.setPlaceholder("/opt/homebrew/bin/boofa-sketch")
					.setValue(this.plugin.settings.customBinaryPath)
					.onChange(async (value) => {
						this.plugin.settings.customBinaryPath = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		void this.showBinaryStatus(containerEl);
	}

	private async showBinaryStatus(containerEl: HTMLElement): Promise<void> {
		const statusEl = containerEl.createEl("p", { text: "Detecting boofa-sketch..." });
		const binaryPath = await this.plugin.findBinary();
		if (binaryPath) {
			statusEl.setText(`boofa-sketch found at: ${binaryPath}`);
			statusEl.addClass("mod-success");
		} else {
			statusEl.setText(
				"Helper not found, run: brew install wasmir/tap/boofa-sketch",
			);
			statusEl.addClass("mod-warning");
		}
	}
}
