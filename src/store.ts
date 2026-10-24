import { App, normalizePath } from "obsidian";
import { emptyPlan, normalisePlan, Plan } from "./model";

export const DEFAULT_PLAN_PATH = ".plan-board/plan.json";

const RECENT_WRITE_MS = 800;

export class PlanStore {
    private cached: Plan | null = null;
    private lastWriteAt = 0;

    constructor(
        private readonly app: App,
        private planPath: string,
    ) {}

    get path(): string {
        return this.planPath;
    }

    setPath(path: string): void {
        this.planPath = normalizePath(path.trim() || DEFAULT_PLAN_PATH);
        this.cached = null;
    }

    get recentlyWritten(): boolean {
        return Date.now() - this.lastWriteAt < RECENT_WRITE_MS;
    }

    async exists(): Promise<boolean> {
        try {
            return await this.app.vault.adapter.exists(this.planPath);
        } catch {
            return false;
        }
    }

    async load(force = false): Promise<Plan> {
        if (this.cached && !force) return this.cached;
        const adapter = this.app.vault.adapter;
        if (!(await adapter.exists(this.planPath))) {
            this.cached = emptyPlan();
            return this.cached;
        }
        const text = await adapter.read(this.planPath);
        let raw: unknown;
        try {
            raw = JSON.parse(text);
        } catch (error) {
            throw new Error(
                `计划文件不是合法 JSON：${this.planPath}\n${String(error)}`,
            );
        }
        this.cached = normalisePlan(raw);
        return this.cached;
    }

    async save(plan: Plan): Promise<void> {
        const adapter = this.app.vault.adapter;
        const folder = this.planPath.split("/").slice(0, -1).join("/");
        if (folder && !(await adapter.exists(folder))) {
            await this.ensureFolder(folder);
        }
        plan.updatedAt = new Date().toISOString();
        const payload = `${JSON.stringify(plan, null, 2)}\n`;
        this.lastWriteAt = Date.now();
        await adapter.write(this.planPath, payload);
        this.cached = plan;
    }

    async mutate(mutator: (plan: Plan) => void): Promise<Plan> {
        const plan = await this.load(true);
        mutator(plan);
        await this.save(plan);
        return plan;
    }

    private async ensureFolder(folder: string): Promise<void> {
        const adapter = this.app.vault.adapter;
        const parts = folder.split("/").filter(Boolean);
        let current = "";
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            if (!(await adapter.exists(current))) {
                await adapter.mkdir(current);
            }
        }
    }
}
