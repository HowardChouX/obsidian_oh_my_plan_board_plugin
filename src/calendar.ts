/**
 * Month-grid helpers for the calendar view.
 *
 * The 42-cell layout (six weeks, leading/trailing days included) follows
 * `getMonth()` from liamcain/obsidian-calendar-ui (MIT). Reimplemented with
 * native Date so the plugin does not need Svelte or moment.
 */

export interface CalendarCell {
    /** Local date in YYYY-MM-DD form. */
    date: string;
    day: number;
    /** False for the leading/trailing days borrowed from adjacent months. */
    inMonth: boolean;
}

export interface CalendarWeek {
    cells: CalendarCell[];
}

/** Monday-first labels, matching the default week start in this vault. */
export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

export function isoFromDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
}

export function parseISODate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
        return null;
    }
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day
    ) {
        return null;
    }
    return date;
}

/**
 * Builds six weeks of seven days. Week starts on Monday by default.
 */
export function buildMonthGrid(year: number, month: number, weekStartsOn = 1): CalendarWeek[] {
    const first = new Date(year, month, 1);
    const offset = (first.getDay() - weekStartsOn + 7) % 7;
    const start = new Date(year, month, 1 - offset);
    const weeks: CalendarWeek[] = [];
    for (let week = 0; week < 6; week += 1) {
        const cells: CalendarCell[] = [];
        for (let day = 0; day < 7; day += 1) {
            const current = new Date(start);
            current.setDate(start.getDate() + week * 7 + day);
            cells.push({
                date: isoFromDate(current),
                day: current.getDate(),
                inMonth: current.getMonth() === month,
            });
        }
        weeks.push({ cells });
    }
    return weeks;
}

export function shiftMonth(
    year: number,
    month: number,
    delta: number,
): { year: number; month: number } {
    const date = new Date(year, month + delta, 1);
    return { year: date.getFullYear(), month: date.getMonth() };
}
