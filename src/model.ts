export type ItemKind = "required" | "optional";

export interface PlanItem {
    id: string;
    text: string;
    kind: ItemKind;
    done: boolean;
    doneAt?: string;
}

export interface PlanDay {
    id: string;
    label: string;
    date?: string;
    title?: string;
    items: PlanItem[];
}

export interface Plan {
    version: 1;
    title: string;
    subtitle?: string;
    startDate?: string;
    createdAt: string;
    updatedAt: string;
    days: PlanDay[];
}

export interface DayProgress {
    done: number;
    total: number;
    requiredDone: number;
    requiredTotal: number;
}

export interface PlanProgress extends DayProgress {
    daysDone: number;
    daysTotal: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nowISO(): string {
    return new Date().toISOString();
}

export function makeId(prefix: string): string {
    const stamp = Date.now().toString(36);
    const salt = Math.random().toString(36).slice(2, 8);
    return `${prefix}-${stamp}${salt}`;
}

export function todayISO(): string {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${month}-${day}`;
}

export function addDaysISO(base: string, days: number): string {
    const [year, month, day] = base.split("-").map(Number);
    const d = new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
    d.setDate(d.getDate() + days);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${dd}`;
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysBetweenISO(start: string, end: string): number {
    const [sy, sm, sd] = start.split("-").map(Number);
    const [ey, em, ed] = end.split("-").map(Number);
    const a = Date.UTC(sy ?? 1970, (sm ?? 1) - 1, sd ?? 1);
    const b = Date.UTC(ey ?? 1970, (em ?? 1) - 1, ed ?? 1);
    return Math.round((b - a) / 86400000) + 1;
}

export function emptyPlan(title = "未命名计划"): Plan {
    const stamp = nowISO();
    return {
        version: 1,
        title,
        createdAt: stamp,
        updatedAt: stamp,
        days: [],
    };
}

export function dayProgress(day: PlanDay): DayProgress {
    let done = 0;
    let requiredDone = 0;
    let requiredTotal = 0;
    for (const item of day.items) {
        if (item.done) done += 1;
        if (item.kind === "required") {
            requiredTotal += 1;
            if (item.done) requiredDone += 1;
        }
    }
    return { done, total: day.items.length, requiredDone, requiredTotal };
}

export function planProgress(plan: Plan): PlanProgress {
    let done = 0;
    let total = 0;
    let requiredDone = 0;
    let requiredTotal = 0;
    let daysDone = 0;
    for (const day of plan.days) {
        const p = dayProgress(day);
        done += p.done;
        total += p.total;
        requiredDone += p.requiredDone;
        requiredTotal += p.requiredTotal;
        if (p.total > 0 && p.done === p.total) daysDone += 1;
    }
    return {
        done,
        total,
        requiredDone,
        requiredTotal,
        daysDone,
        daysTotal: plan.days.length,
    };
}

export function percent(done: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((done / total) * 100);
}

function normaliseItem(raw: unknown, index: number, fallbackId: string): PlanItem {
    if (typeof raw === "string") {
        return {
            id: `${fallbackId}-${index + 1}`,
            text: raw,
            kind: "required",
            done: false,
        };
    }
    const rec = isRecord(raw) ? raw : {};
    const text = typeof rec.text === "string" ? rec.text : String(rec.text ?? "").trim();
    const kind: ItemKind = rec.kind === "optional" ? "optional" : "required";
    return {
        id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `${fallbackId}-${index + 1}`,
        text,
        kind,
        done: rec.done === true,
        ...(typeof rec.doneAt === "string" ? { doneAt: rec.doneAt } : {}),
    };
}

export function normalisePlan(raw: unknown, fallbackTitle = "未命名计划"): Plan {
    if (!isRecord(raw)) return emptyPlan(fallbackTitle);
    const stamp = nowISO();
    const rawStart =
        typeof raw.startDate === "string" && raw.startDate.trim()
            ? raw.startDate.trim()
            : "";
    const rawDays = Array.isArray(raw.days) ? raw.days : [];
    const seenDays = new Set<string>();
    const days: PlanDay[] = [];

    rawDays.forEach((rawDay, dayIndex) => {
        const rec = isRecord(rawDay) ? rawDay : {};
        let id =
            typeof rec.id === "string" && rec.id.trim()
                ? rec.id.trim()
                : `d${dayIndex + 1}`;
        while (seenDays.has(id)) id = `${id}-${dayIndex + 1}`;
        seenDays.add(id);

        const rawItems = Array.isArray(rec.items) ? rec.items : [];
        const seenItems = new Set<string>();
        const items: PlanItem[] = [];
        rawItems.forEach((rawItem, itemIndex) => {
            const item = normaliseItem(rawItem, itemIndex, id);
            let itemId = item.id;
            while (seenItems.has(itemId)) itemId = `${itemId}-${itemIndex + 1}`;
            seenItems.add(itemId);
            items.push({ ...item, id: itemId });
        });

        days.push({
            id,
            label:
                typeof rec.label === "string" && rec.label.trim()
                    ? rec.label.trim()
                    : `Day ${dayIndex + 1}`,
            ...(typeof rec.date === "string" && rec.date.trim()
                ? { date: rec.date.trim() }
                : rawStart
                  ? { date: addDaysISO(rawStart, dayIndex) }
                  : {}),
            ...(typeof rec.title === "string" && rec.title.trim()
                ? { title: rec.title.trim() }
                : {}),
            items,
        });
    });

    return {
        version: 1,
        title:
            typeof raw.title === "string" && raw.title.trim()
                ? raw.title.trim()
                : fallbackTitle,
        ...(typeof raw.subtitle === "string" && raw.subtitle.trim()
            ? { subtitle: raw.subtitle.trim() }
            : {}),
        ...(rawStart ? { startDate: rawStart } : {}),
        createdAt: typeof raw.createdAt === "string" ? raw.createdAt : stamp,
        updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : stamp,
        days,
    };
}

/** Resolves a day by id, by 1-based number, or by label. */
export function findDay(plan: Plan, ref: string): PlanDay | undefined {
    const needle = ref.trim().toLowerCase();
    if (!needle) return undefined;
    const byId = plan.days.find((day) => day.id.toLowerCase() === needle);
    if (byId) return byId;
    const byLabel = plan.days.find((day) => day.label.toLowerCase() === needle);
    if (byLabel) return byLabel;
    const asNumber = Number(needle);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= plan.days.length) {
        return plan.days[asNumber - 1];
    }
    return plan.days.find((day) => day.id === ref);
}

/** Resolves an item by id or by 1-based position inside a day. */
export function findItem(day: PlanDay, ref: string): PlanItem | undefined {
    const needle = ref.trim().toLowerCase();
    if (!needle) return undefined;
    const byId = day.items.find((item) => item.id.toLowerCase() === needle);
    if (byId) return byId;
    const asNumber = Number(needle);
    if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= day.items.length) {
        return day.items[asNumber - 1];
    }
    return undefined;
}

/** Next free "Day N" label, ignoring custom labels. */
export function nextDayLabel(plan: Plan): string {
    let max = 0;
    let matched = false;
    for (const day of plan.days) {
        const match = /^Day\s*(\d+)$/i.exec(day.label);
        if (!match) continue;
        matched = true;
        max = Math.max(max, Number(match[1]));
    }
    return `Day ${(matched ? max : plan.days.length) + 1}`;
}
