import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type PlanBoardPlugin from "./main";
import { DEFAULT_PLAN_PATH } from "./store";

export interface PlanBoardSettings {
    planPath: string;
}

export const DEFAULT_SETTINGS: PlanBoardSettings = {
    planPath: DEFAULT_PLAN_PATH,
};

export function normaliseSettings(data: unknown): PlanBoardSettings {
    const stored = (data ?? {}) as Partial<Record<keyof PlanBoardSettings, unknown>>;
    const path =
        typeof stored.planPath === "string" && stored.planPath.trim()
            ? stored.planPath.trim()
            : DEFAULT_PLAN_PATH;
    return { planPath: path };
}

export class PlanBoardSettingTab extends PluginSettingTab {
    plugin: PlanBoardPlugin;

    constructor(app: App, plugin: PlanBoardPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("计划文件路径")
            .setDesc(
                "JSON 文件，相对于 Vault 根目录。插件与命令行工具读写同一个文件。",
            )
            .addText((text) =>
                text
                    .setPlaceholder(DEFAULT_PLAN_PATH)
                    .setValue(this.plugin.settings.planPath)
                    .onChange(async (value) => {
                        this.plugin.settings.planPath = value.trim() || DEFAULT_PLAN_PATH;
                        this.plugin.store.setPath(this.plugin.settings.planPath);
                        await this.plugin.saveSettings();
                        await this.plugin.refreshViews(true);
                    }),
            )
            .addButton((button) =>
                button.setButtonText("打开面板").onClick(() => {
                    void this.plugin.activateView();
                }),
            );

        new Setting(containerEl)
            .setName("命令行工具")
            .setDesc(
                "外部工具通过 cli.mjs 读写同一个 JSON 文件；用法见插件目录中的 README.md。",
            );

        new Setting(containerEl)
            .setName("初始化计划文件")
            .setDesc("文件不存在时创建一个空计划；已存在则不会覆盖。")
            .addButton((button) =>
                button.setButtonText("创建").onClick(async () => {
                    const created = await this.plugin.ensurePlanFile();
                    new Notice(
                        created ? "已创建计划文件" : "计划文件已存在，未改动",
                    );
                }),
            );
    }
}
