import { App, normalizePath } from "obsidian";
import {
    addDaysISO,
    emptyPlan,
    makeId,
    type Plan,
    type PlanDay,
} from "./model";

export const PLANS_DIR = ".plan-board/plans";
export const LEGACY_PLAN_PATH = ".plan-board/plan.json";

export interface PlanOption {
    path: string;
    title: string;
}

async function readTitle(app: App, path: string): Promise<string> {
    try {
        const raw: unknown = JSON.parse(await app.vault.adapter.read(path));
        if (
            typeof raw === "object" &&
            raw !== null &&
            typeof (raw as { title?: unknown }).title === "string" &&
            ((raw as { title: string }).title ?? "").trim()
        ) {
            return (raw as { title: string }).title.trim();
        }
    } catch {
        // Fall through to the file name.
    }
    const name = path.split("/").pop() ?? path;
    return name.replace(/\.json$/i, "");
}

/** All plan files: the legacy single file, plus every JSON under .plan-board/plans. */
export async function listPlanOptions(
    app: App,
    activePath: string,
): Promise<PlanOption[]> {
    const adapter = app.vault.adapter;
    const paths = new Set<string>();
    if (await adapter.exists(LEGACY_PLAN_PATH)) {
        paths.add(normalizePath(LEGACY_PLAN_PATH));
    }
    if (await adapter.exists(PLANS_DIR)) {
        try {
            const listing = await adapter.list(PLANS_DIR);
            for (const file of listing.files) {
                if (file.toLowerCase().endsWith(".json")) {
                    paths.add(normalizePath(file));
                }
            }
        } catch {
            // The folder can disappear while Obsidian is running.
        }
    }
    if (activePath && (await adapter.exists(activePath))) {
        paths.add(normalizePath(activePath));
    }

    const options: PlanOption[] = [];
    for (const path of paths) {
        options.push({ path, title: await readTitle(app, path) });
    }
    return options.sort((a, b) => a.path.localeCompare(b.path));
}

/** Filesystem-safe plan path derived from the title. */
export function planPathFor(title: string): string {
    const slug = title
        .trim()
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, " ")
        .slice(0, 60);
    return normalizePath(`${PLANS_DIR}/${slug || `plan-${Date.now()}`}.json`);
}

export function buildPlan(title: string, startDate: string, dayCount: number): Plan {
    const plan = emptyPlan(title);
    plan.startDate = startDate;
    const count = Math.max(1, Math.min(366, Math.floor(dayCount)));
    const days: PlanDay[] = [];
    for (let index = 0; index < count; index += 1) {
        days.push({
            id: makeId("d"),
            label: `Day ${index + 1}`,
            date: addDaysISO(startDate, index),
            items: [],
        });
    }
    plan.days = days;
    return plan;
}
