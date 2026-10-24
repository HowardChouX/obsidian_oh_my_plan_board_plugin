import { Notice, Plugin, WorkspaceLeaf, normalizePath } from "obsidian";
import { daysBetweenISO, emptyPlan } from "./model";
import { NewPlanModal, type NewPlanOptions } from "./new-plan-modal";
import { buildPlan, planPathFor } from "./plans";
import {
    DEFAULT_SETTINGS,
    normaliseSettings,
    PlanBoardSettingTab,
    type PlanBoardSettings,
} from "./settings";
import { PlanStore } from "./store";
import { PlanBoardView, VIEW_TYPE } from "./view";

export interface PlanBoardApi {
    load(): Promise<unknown>;
    save(plan: unknown): Promise<void>;
    refresh(): Promise<void>;
    open(): Promise<void>;
    path(): string;
}

export default class PlanBoardPlugin extends Plugin {
    settings: PlanBoardSettings = { ...DEFAULT_SETTINGS };
    store!: PlanStore;
    private readonly stores = new Map<string, PlanStore>();
    private lastWriteAt = 0;
    private refreshTimer: number | null = null;

    readonly api: PlanBoardApi = {
        load: () => this.store.load(true),
        save: async (plan) => {
            await this.store.save(plan as never);
            await this.refreshViews(true);
        },
        refresh: () => this.refreshViews(true),
        open: () => this.activateView(),
        path: () => this.store.path,
    };

    async onload(): Promise<void> {
        await this.loadSettings();
        this.store = new PlanStore(this.app, this.settings.planPath);

        this.registerView(VIEW_TYPE, (leaf) => new PlanBoardView(leaf, this));

        this.addRibbonIcon("list-checks", "打开计划面板", () => {
            void this.activateView();
        });

        this.addCommand({
            id: "open",
            name: "打开计划面板",
            callback: () => void this.activateView(),
        });

        this.addCommand({
            id: "reload",
            name: "重新载入计划文件",
            callback: async () => {
                await this.refreshViews(true);
                new Notice("计划已重新载入");
            },
        });

        this.addCommand({
            id: "create-plan-file",
            name: "创建计划文件",
            callback: async () => {
                const created = await this.ensurePlanFile();
                new Notice(created ? "已创建计划文件" : "计划文件已存在，未改动");
                await this.activateView();
            },
        });

        this.addCommand({
            id: "new-plan",
            name: "新建计划",
            callback: () => {
                new NewPlanModal(this.app, (options) => {
                    void this.createPlan(options)
                        .then(() => this.activateView())
                        .catch((error) => {
                            new Notice(`新建计划失败：${String(error)}`);
                        });
                }).open();
            },
        });

        this.addSettingTab(new PlanBoardSettingTab(this.app, this));

        const watch = (file: { path: string }): void => {
            const path = normalizePath(file.path);
            if (path.startsWith(".plan-board/") && path.endsWith(".json")) {
                this.scheduleRefresh();
            }
        };
        this.registerEvent(this.app.vault.on("modify", watch));
        this.registerEvent(this.app.vault.on("create", watch));
        this.registerEvent(this.app.vault.on("delete", watch));

        // Other plugins and the developer console can reach the same store.
        (window as unknown as Record<string, unknown>).planBoard = this.api;
    }

    onunload(): void {
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        delete (window as unknown as Record<string, unknown>).planBoard;
        this.app.workspace.detachLeavesOfType(VIEW_TYPE);
    }

    /** Shared store per plan file; the active path reuses this.store. */
    storeFor(path: string): PlanStore {
        const normalized = normalizePath(path);
        if (normalized === this.store.path) return this.store;
        let store = this.stores.get(normalized);
        if (!store) {
            store = new PlanStore(this.app, normalized);
            this.stores.set(normalized, store);
        }
        return store;
    }

    markWrite(): void {
        this.lastWriteAt = Date.now();
    }

    async loadSettings(): Promise<void> {
        this.settings = normaliseSettings(await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    async ensurePlanFile(): Promise<boolean> {
        if (await this.store.exists()) return false;
        await this.store.save(emptyPlan());
        await this.refreshViews(true);
        return true;
    }

    /** Creates a new plan file under .plan-board/plans and makes it active. */
    async createPlan(options: NewPlanOptions): Promise<string> {
        const adapter = this.app.vault.adapter;
        let path = planPathFor(options.title);
        let suffix = 2;
        while (await adapter.exists(path)) {
            path = planPathFor(`${options.title} (${suffix})`);
            suffix += 1;
        }
        const dayCount = daysBetweenISO(options.startDate, options.endDate);
        const plan = buildPlan(options.title, options.startDate, dayCount);
        this.store.setPath(path);
        await this.store.save(plan);
        this.settings.planPath = path;
        await this.saveSettings();
        await this.refreshViews(true);
        return path;
    }

    async activateView(): Promise<void> {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(VIEW_TYPE)[0];
        if (existing) {
            await workspace.revealLeaf(existing);
            return;
        }
        const leaf: WorkspaceLeaf =
            workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPE, active: true });
        await workspace.revealLeaf(leaf);
    }

    async refreshViews(force = true): Promise<void> {
        for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
            const view = leaf.view;
            if (view instanceof PlanBoardView) {
                await view.reload(force);
            }
        }
    }

    private scheduleRefresh(): void {
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
            this.refreshTimer = null;
            if (Date.now() - this.lastWriteAt < 800) return;
            void this.refreshViews(true);
        }, 180);
    }
}
