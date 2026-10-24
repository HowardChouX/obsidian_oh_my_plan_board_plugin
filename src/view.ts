import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type PlanBoardPlugin from "./main";
import { NewPlanModal } from "./new-plan-modal";
import { listPlanOptions, type PlanOption } from "./plans";
import { DEFAULT_PLAN_PATH } from "./store";
import {
    dayProgress,
    makeId,
    nextDayLabel,
    percent,
    planProgress,
    todayISO,
    type ItemKind,
    type Plan,
    type PlanDay,
} from "./model";
import {
    buildMonthGrid,
    parseISODate,
    shiftMonth,
    WEEKDAY_LABELS,
} from "./calendar";

export const VIEW_TYPE = "plan-board-view";

interface LoadedPlan {
    path: string;
    title: string;
    plan: Plan;
}

interface DayRef {
    path: string;
    plan: Plan;
    day: PlanDay;
}

interface GroupElements {
    count: HTMLElement;
}

interface DayElements {
    section: HTMLElement;
    count: HTMLElement;
    bar: HTMLElement;
    groups: Map<ItemKind, GroupElements>;
}

function dayKey(path: string, dayId: string): string {
    return `${path}::${dayId}`;
}

function itemKey(path: string, itemId: string): string {
    return `${path}::${itemId}`;
}

function createTick(): SVGElement {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "pb-tick");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", "M3.2 8.4 L6.4 11.6 L12.8 4.4");
    svg.appendChild(path);
    return svg;
}

export class PlanBoardView extends ItemView {
    private readonly plugin: PlanBoardPlugin;
    private plans: LoadedPlan[] = [];
    private planOptions: PlanOption[] = [];
    private loadError: string | null = null;
    private displayYear = new Date().getFullYear();
    private displayMonth = new Date().getMonth();
    private selectedDate: string | null = null;
    private planFilter: string | null = null;
    private loadedPath: string | null = null;
    private readonly collapsed = new Set<string>();
    private readonly dayEls = new Map<string, DayElements>();
    private readonly itemEls = new Map<string, HTMLElement>();
    private readonly dayByDate = new Map<string, DayRef[]>();
    private readonly calCells = new Map<
        string,
        { el: HTMLElement; ring: SVGCircleElement }
    >();
    private overallRing: SVGCircleElement | null = null;
    private overallPctEl: HTMLElement | null = null;
    private overallMetaEl: HTMLElement | null = null;
    private todayRing: SVGCircleElement | null = null;
    private todayPctEl: HTMLElement | null = null;
    private todayMetaEl: HTMLElement | null = null;
    private readonly planRows = new Map<
        string,
        { row: HTMLElement; bar: HTMLElement; pct: HTMLElement; count: HTMLElement }
    >();
    private saveChain: Promise<void> = Promise.resolve();
    private pendingFocus: { path: string; dayId: string; kind: ItemKind } | null = null;
    private reloadToken = 0;

    constructor(leaf: WorkspaceLeaf, plugin: PlanBoardPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return "计划面板";
    }

    getIcon(): string {
        return "list-checks";
    }

    private get filteredPlan(): LoadedPlan | undefined {
        return this.planFilter
            ? this.plans.find((entry) => entry.path === this.planFilter)
            : undefined;
    }

    private get visiblePlans(): LoadedPlan[] {
        return this.planFilter
            ? this.plans.filter((entry) => entry.path === this.planFilter)
            : this.plans;
    }

    async onOpen(): Promise<void> {
        this.contentEl.addClass("pb-root");
        await this.reload(true);
    }

    async reload(force = false): Promise<void> {
        const token = ++this.reloadToken;
        try {
            const options = await listPlanOptions(
                this.app,
                this.plugin.store.path,
            );
            const loaded: LoadedPlan[] = [];
            for (const option of options) {
                try {
                    const plan = await this.plugin.storeFor(option.path).load(force);
                    loaded.push({
                        path: option.path,
                        title: plan.title || option.title,
                        plan,
                    });
                } catch (error) {
                    if (option.path === this.plugin.store.path) throw error;
                }
            }
            if (token !== this.reloadToken) return;
            this.plans = loaded;
            this.planOptions = options;
            if (this.loadedPath !== this.plugin.store.path) {
                this.loadedPath = this.plugin.store.path;
                this.selectedDate = null;
                this.focusPlanMonth();
            }
            this.loadError = null;
        } catch (error) {
            if (token !== this.reloadToken) return;
            this.plans = [];
            this.loadError = error instanceof Error ? error.message : String(error);
        }
        if (token === this.reloadToken) this.render();
    }

    // ---------------------------------------------------------------- render

    private render(): void {
        const root = this.contentEl;
        const scrollTop = root.scrollTop;
        root.empty();
        root.addClass("pb-root");
        this.dayEls.clear();
        this.itemEls.clear();
        this.dayByDate.clear();
        this.calCells.clear();
        this.planRows.clear();
        this.overallRing = null;
        this.overallPctEl = null;
        this.overallMetaEl = null;
        this.todayRing = null;
        this.todayPctEl = null;
        this.todayMetaEl = null;

        if (this.loadError) {
            this.renderError(root, this.loadError);
            return;
        }

        this.renderHeader(root);
        this.renderDashboard(root);
        this.renderCalendar(root);
        this.updateProgress();
        this.restoreFocus();
        root.scrollTop = scrollTop;
    }

    private renderError(root: HTMLElement, message: string): void {
        const box = root.createDiv({ cls: "pb-error" });
        box.createDiv({ cls: "pb-error-title", text: "计划文件读取失败" });
        box.createDiv({ cls: "pb-error-body", text: message });
        const retry = box.createEl("button", {
            cls: "pb-text-btn",
            text: "重试",
            attr: { type: "button" },
        });
        retry.addEventListener("click", () => void this.reload(true));
    }

    private renderHeader(root: HTMLElement): void {
        const header = root.createDiv({ cls: "pb-header" });
        const filtered = this.filteredPlan;

        const titleRow = header.createDiv({ cls: "pb-title-row" });
        const titleText = filtered?.plan.title ?? "所有计划";
        const title = titleRow.createDiv({ cls: "pb-title", text: titleText });
        if (filtered) {
            title.setAttribute("title", "双击重命名当前计划");
            title.addEventListener("dblclick", () => {
                this.editPlanTitle(filtered, title);
            });
        }

        const planBar = header.createDiv({ cls: "pb-planbar" });
        const planSelect = planBar.createEl("select", { cls: "pb-plan-select" });
        planSelect.createEl("option", { text: "全部计划", value: "" });
        const options =
            this.planOptions.length > 0
                ? this.planOptions
                : this.plans.map((entry) => ({
                      path: entry.path,
                      title: entry.title,
                  }));
        for (const option of options) {
            planSelect.createEl("option", {
                text: option.title,
                value: option.path,
            });
        }
        planSelect.value = this.planFilter ?? "";
        planSelect.addEventListener("change", () => {
            this.planFilter = planSelect.value || null;
            if (!this.selectedDate) this.focusPlanMonth();
            this.render();
        });
        const newPlanButton = planBar.createEl("button", {
            cls: "pb-text-btn pb-primary",
            text: "新建计划",
            attr: { type: "button" },
        });
        newPlanButton.addEventListener("click", () => this.openNewPlanModal());

        if (filtered) {
            const deletePlanButton = planBar.createEl("button", {
                cls: "pb-text-btn",
                text: "删除计划",
                attr: { type: "button", "aria-label": "删除当前计划" },
            });
            let confirming = false;
            let confirmTimer: number | null = null;
            deletePlanButton.addEventListener("click", () => {
                if (!confirming) {
                    confirming = true;
                    deletePlanButton.setText("确认删除");
                    deletePlanButton.addClass("is-confirming");
                    confirmTimer = window.setTimeout(() => {
                        confirming = false;
                        deletePlanButton.setText("删除计划");
                        deletePlanButton.removeClass("is-confirming");
                    }, 2500);
                    return;
                }
                if (confirmTimer !== null) window.clearTimeout(confirmTimer);
                void this.deletePlan(filtered);
            });
        }

        const subtitle = filtered
            ? filtered.plan.subtitle
            : this.plans.length > 1
              ? `共 ${this.plans.length} 份计划`
              : undefined;
        if (subtitle) header.createDiv({ cls: "pb-subtitle", text: subtitle });

    }

    // -------------------------------------------------------------- dashboard

    private renderDashboard(root: HTMLElement): void {
        const dash = root.createDiv({ cls: "pb-dash" });
        const rings = dash.createDiv({ cls: "pb-dash-rings" });
        const overall = this.createRing(rings, "总进度");
        this.overallRing = overall.ring;
        this.overallPctEl = overall.pct;
        this.overallMetaEl = overall.meta;
        const today = this.createRing(rings, "今日");
        this.todayRing = today.ring;
        this.todayPctEl = today.pct;
        this.todayMetaEl = today.meta;

        const list = dash.createDiv({ cls: "pb-dash-plans" });
        for (const entry of this.visiblePlans) {
            const row = list.createDiv({ cls: "pb-plan-row" });
            row.createSpan({ cls: "pb-plan-name", text: entry.title });
            const barWrap = row.createSpan({ cls: "pb-plan-bar" });
            const bar = barWrap.createSpan();
            const count = row.createSpan({ cls: "pb-plan-count" });
            const pct = row.createSpan({ cls: "pb-plan-pct" });
            this.planRows.set(entry.path, { row, bar, pct, count });
        }
    }

    private createRing(
        container: HTMLElement,
        caption: string,
    ): {
        ring: SVGCircleElement;
        pct: HTMLElement;
        meta: HTMLElement;
    } {
        const ns = "http://www.w3.org/2000/svg";
        const radius = 22;
        const circumference = 2 * Math.PI * radius;
        const wrap = container.createDiv({ cls: "pb-ring" });
        const ringWrap = wrap.createDiv({ cls: "pb-ring-wrap" });
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 56 56");
        svg.setAttribute("class", "pb-ring-svg");
        const track = document.createElementNS(ns, "circle");
        track.setAttribute("cx", "28");
        track.setAttribute("cy", "28");
        track.setAttribute("r", String(radius));
        track.setAttribute("class", "pb-ring-track");
        const value = document.createElementNS(ns, "circle");
        value.setAttribute("cx", "28");
        value.setAttribute("cy", "28");
        value.setAttribute("r", String(radius));
        value.setAttribute("class", "pb-ring-value");
        value.style.strokeDasharray = String(circumference);
        value.style.strokeDashoffset = String(circumference);
        svg.appendChild(track);
        svg.appendChild(value);
        ringWrap.appendChild(svg);
        const center = ringWrap.createDiv({ cls: "pb-ring-center" });
        const pct = center.createSpan({ cls: "pb-ring-pct", text: "0%" });
        wrap.createDiv({ cls: "pb-ring-caption", text: caption });
        const meta = wrap.createDiv({ cls: "pb-ring-meta", text: "0/0" });
        return { ring: value, pct, meta };
    }

    // -------------------------------------------------------------- calendar

    private focusPlanMonth(): void {
        const plans = this.visiblePlans;
        const dated =
            plans.flatMap((entry) => entry.plan.days).find((day) => day.date) ??
            this.plans.flatMap((entry) => entry.plan.days).find((day) => day.date);
        const parsed = dated?.date ? parseISODate(dated.date) : null;
        const target = parsed ?? parseISODate(todayISO());
        if (!target) return;
        this.displayYear = target.getFullYear();
        this.displayMonth = target.getMonth();
    }

    private renderCalendar(root: HTMLElement): void {
        const wrap = root.createDiv({ cls: "pb-cal" });

        const nav = wrap.createDiv({ cls: "pb-cal-nav" });
        const previous = nav.createEl("button", {
            cls: "pb-cal-navbtn",
            text: "‹",
            attr: { type: "button", "aria-label": "上个月" },
        });
        previous.addEventListener("click", () => this.shiftDisplayMonth(-1));
        nav.createDiv({
            cls: "pb-cal-title",
            text: `${this.displayYear} 年 ${this.displayMonth + 1} 月`,
        });
        const next = nav.createEl("button", {
            cls: "pb-cal-navbtn",
            text: "›",
            attr: { type: "button", "aria-label": "下个月" },
        });
        next.addEventListener("click", () => this.shiftDisplayMonth(1));
        const todayButton = nav.createEl("button", {
            cls: "pb-cal-today",
            text: "今天",
            attr: { type: "button" },
        });
        todayButton.addEventListener("click", () => this.goToday());

        const visible = this.visiblePlans;
        this.dayByDate.clear();
        for (const entry of visible) {
            for (const day of entry.plan.days) {
                if (!day.date) continue;
                const refs = this.dayByDate.get(day.date) ?? [];
                refs.push({ path: entry.path, plan: entry.plan, day });
                this.dayByDate.set(day.date, refs);
            }
        }

        const weeks = buildMonthGrid(this.displayYear, this.displayMonth);

        const weekdays = wrap.createDiv({ cls: "pb-cal-weekdays" });
        WEEKDAY_LABELS.forEach((label, index) => {
            const element = weekdays.createSpan({
                cls: "pb-cal-weekday",
                text: label,
            });
            if (index >= 5) element.addClass("is-weekend");
        });

        const today = todayISO();
        const grid = wrap.createDiv({ cls: "pb-cal-grid" });
        for (const week of weeks) {
            week.cells.forEach((cell, index) => {
                const cellIndex = index;
                const refs = this.dayByDate.get(cell.date) ?? [];
                const button = grid.createEl("button", {
                    cls: "pb-cal-cell",
                    attr: { type: "button", "aria-label": cell.date },
                });
                if (!cell.inMonth) button.addClass("is-outside");
                if (cell.date === today) button.addClass("is-today");
                if (cell.date === this.selectedDate) button.addClass("is-selected");
                if (refs.length > 0) button.addClass("has-plan");
                if (refs.length === 0) {
                    button.createSpan({
                        cls: "pb-cal-num",
                        text: String(cell.day),
                    });
                } else {
                    const total = refs.reduce(
                        (sum, ref) => sum + ref.day.items.length,
                        0,
                    );
                    const done = refs.reduce(
                        (sum, ref) =>
                            sum + ref.day.items.filter((item) => item.done).length,
                        0,
                    );
                    const complete = total > 0 && done === total;
                    const overdue =
                        total > 0 && done < total && cell.date < today;
                    const showRing =
                        done > 0 || complete || overdue || cell.date === today;
                    if (complete) button.addClass("is-complete");
                    if (overdue) button.addClass("is-overdue");
                    if (!showRing) button.addClass("is-plain");
                    button.setAttribute(
                        "title",
                        refs
                            .map(
                                (ref) =>
                                    `${ref.plan.title}: ${ref.day.title ?? ref.day.label}`,
                            )
                            .join("；"),
                    );
                    const ringWrap = button.createSpan({ cls: "pb-cal-ring" });
                    const ring = this.createCellRing();
                    ringWrap.appendChild(ring.svg);
                    ringWrap.createSpan({
                        cls: "pb-cal-num",
                        text: String(cell.day),
                    });
                    button.createSpan({ cls: "pb-cal-dot" });
                    this.calCells.set(cell.date, {
                        el: button,
                        ring: ring.ring,
                    });
                }
                if (cellIndex >= 5) button.addClass("is-weekend");
                button.addEventListener("click", () =>
                    this.selectDate(cell.date, cell.inMonth),
                );
            });
        }

        const detail = wrap.createDiv({ cls: "pb-cal-detail" });
        if (!this.selectedDate) {
            detail.createDiv({
                cls: "pb-cal-empty",
                text:
                    this.plans.length > 0
                        ? "点击日期查看当天所有计划的清单"
                        : "先新建一份计划",
            });
            return;
        }
        const refs = this.dayByDate.get(this.selectedDate) ?? [];
        if (refs.length === 0) {
            this.renderCalendarEmpty(detail);
            return;
        }
        for (const ref of refs) {
            if (visible.length > 1) {
                const head = detail.createDiv({ cls: "pb-plan-section-head" });
                head.createSpan({
                    cls: "pb-plan-section-title",
                    text: ref.plan.title,
                });
                const progress = dayProgress(ref.day);
                head.createSpan({
                    cls: "pb-plan-section-count",
                    text: `${progress.done}/${progress.total}`,
                });
            }
            this.renderDay(detail, ref);
        }
    }

    private createCellRing(): {
        svg: SVGSVGElement;
        ring: SVGCircleElement;
    } {
        const ns = "http://www.w3.org/2000/svg";
        const radius = 13;
        const circumference = 2 * Math.PI * radius;
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 32 32");
        svg.setAttribute("class", "pb-cal-ring-svg");
        const track = document.createElementNS(ns, "circle");
        track.setAttribute("cx", "16");
        track.setAttribute("cy", "16");
        track.setAttribute("r", String(radius));
        track.setAttribute("class", "pb-cal-ring-track");
        const ring = document.createElementNS(ns, "circle");
        ring.setAttribute("cx", "16");
        ring.setAttribute("cy", "16");
        ring.setAttribute("r", String(radius));
        ring.setAttribute("class", "pb-cal-ring-value");
        ring.style.strokeDasharray = String(circumference);
        ring.style.strokeDashoffset = String(circumference);
        svg.appendChild(track);
        svg.appendChild(ring);
        return { svg, ring };
    }

    private renderCalendarEmpty(container: HTMLElement): void {
        const box = container.createDiv({ cls: "pb-cal-empty" });
        box.createDiv({ cls: "pb-cal-empty-text", text: "这天还没有任何计划" });
        if (this.visiblePlans.length === 0) {
            box.createDiv({ cls: "pb-cal-empty-hint", text: "先在顶部新建计划" });
            return;
        }
        const actions = box.createDiv({ cls: "pb-cal-empty-actions" });
        for (const entry of this.visiblePlans) {
            const add = actions.createEl("button", {
                cls: "pb-add-plan-btn",
                text: `添加到 ${entry.title}`,
                attr: {
                    type: "button",
                    title: `为 ${entry.title} 添加这一天`,
                },
            });
            add.addEventListener("click", () => {
                if (this.selectedDate) {
                    void this.addDayForDate(this.selectedDate, entry);
                }
            });
        }
    }

    private selectDate(date: string, inMonth: boolean): void {
        const parsed = parseISODate(date);
        if (!inMonth && parsed) {
            this.displayYear = parsed.getFullYear();
            this.displayMonth = parsed.getMonth();
        }
        this.selectedDate = date;
        this.render();
        const detail = this.contentEl.querySelector<HTMLElement>(".pb-cal-detail");
        if (detail) {
            const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            detail.scrollIntoView({
                block: "nearest",
                behavior: reduce ? "auto" : "smooth",
            });
        }
    }

    private shiftDisplayMonth(delta: number): void {
        const next = shiftMonth(this.displayYear, this.displayMonth, delta);
        this.displayYear = next.year;
        this.displayMonth = next.month;
        this.render();
    }

    private goToday(): void {
        const today = todayISO();
        const parsed = parseISODate(today);
        if (!parsed) return;
        this.displayYear = parsed.getFullYear();
        this.displayMonth = parsed.getMonth();
        this.selectedDate = today;
        this.render();
    }

    private async addDayForDate(date: string, entry: LoadedPlan): Promise<void> {
        const day: PlanDay = {
            id: makeId("d"),
            label: nextDayLabel(entry.plan),
            date,
            items: [],
        };
        entry.plan.days.push(day);
        this.selectedDate = date;
        await this.save(entry.path, entry.plan);
        this.render();
    }

    // ------------------------------------------------------------------- day

    private renderDay(container: HTMLElement, ref: DayRef): void {
        const key = dayKey(ref.path, ref.day.id);
        const section = container.createEl("section", { cls: "pb-day" });
        section.dataset.day = ref.day.id;
        section.dataset.path = ref.path;
        if (ref.day.date === todayISO()) section.addClass("is-today");
        if (this.collapsed.has(key)) section.addClass("is-collapsed");

        const head = section.createDiv({
            cls: "pb-day-head",
            attr: {
                role: "button",
                tabindex: "0",
                "aria-expanded": this.collapsed.has(key) ? "false" : "true",
            },
        });
        head.addEventListener("click", () => this.toggleCollapse(key));
        head.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.toggleCollapse(key);
            }
        });

        head.createSpan({ cls: "pb-day-label", text: ref.day.label });
        if (ref.day.date) {
            head.createSpan({ cls: "pb-day-date", text: ref.day.date.slice(5) });
        }
        const titleEl = head.createSpan({
            cls: "pb-day-title",
            text: ref.day.title ?? "未命名",
        });
        if (!ref.day.title) titleEl.addClass("is-empty");
        titleEl.setAttribute("title", "双击重命名");
        titleEl.addEventListener("dblclick", (event) => {
            event.stopPropagation();
            this.editDayTitle(ref, titleEl);
        });
        const count = head.createSpan({ cls: "pb-day-count" });
        const barWrap = head.createSpan({ cls: "pb-day-bar" });
        const bar = barWrap.createSpan();

        const actions = head.createSpan({ cls: "pb-day-actions" });
        const rename = actions.createEl("button", {
            cls: "pb-day-action",
            text: "改",
            attr: { type: "button", "aria-label": "重命名这一天" },
        });
        rename.addEventListener("click", (event) => {
            event.stopPropagation();
            this.editDayTitle(ref, titleEl);
        });
        const remove = actions.createEl("button", {
            cls: "pb-day-action",
            text: "删",
            attr: { type: "button", "aria-label": "删除这一天" },
        });
        let confirming = false;
        let confirmTimer: number | null = null;
        remove.addEventListener("click", (event) => {
            event.stopPropagation();
            if (!confirming) {
                confirming = true;
                remove.setText("确认");
                remove.addClass("is-confirming");
                confirmTimer = window.setTimeout(() => {
                    confirming = false;
                    remove.setText("删");
                    remove.removeClass("is-confirming");
                }, 2500);
                return;
            }
            if (confirmTimer !== null) window.clearTimeout(confirmTimer);
            void this.deleteDay(ref);
        });
        head.createSpan({ cls: "pb-caret" });

        const body = section.createDiv({ cls: "pb-day-body" });

        for (const kind of ["required", "optional"] as ItemKind[]) {
            const items = ref.day.items.filter((item) => item.kind === kind);
            const group = body.createDiv({ cls: "pb-group" });
            group.dataset.kind = kind;
            const label = group.createDiv({ cls: "pb-group-label" });
            label.createSpan({ text: kind === "required" ? "必做" : "学有余力" });
            const groupCount = label.createSpan({ cls: "pb-group-count" });
            const itemsEl = group.createDiv({ cls: "pb-items" });
            for (const item of items) this.renderItem(itemsEl, ref, item.id);
            this.renderAddRow(group, ref, kind);
            this.ensureDayEls(key).groups.set(kind, { count: groupCount });
        }

        const els = this.ensureDayEls(key);
        els.section = section;
        els.count = count;
        els.bar = bar;
    }

    private ensureDayEls(key: string): DayElements {
        let els = this.dayEls.get(key);
        if (!els) {
            els = {
                section: document.createElement("section"),
                count: document.createElement("span"),
                bar: document.createElement("span"),
                groups: new Map<ItemKind, GroupElements>(),
            };
            this.dayEls.set(key, els);
        }
        return els;
    }

    private renderItem(listEl: HTMLElement, ref: DayRef, itemId: string): void {
        const item = ref.day.items.find((entry) => entry.id === itemId);
        if (!item) return;
        const key = itemKey(ref.path, item.id);

        const row = listEl.createDiv({
            cls: "pb-item",
            attr: { role: "checkbox", tabindex: "0" },
        });
        row.dataset.item = item.id;
        row.dataset.path = ref.path;
        row.setAttribute("aria-checked", item.done ? "true" : "false");
        if (item.done) row.addClass("is-done");

        const box = row.createSpan({ cls: "pb-box" });
        box.appendChild(createTick());
        row.createSpan({ cls: "pb-item-text", text: item.text });

        const actions = row.createSpan({ cls: "pb-item-actions" });
        const edit = actions.createEl("button", {
            cls: "pb-item-action",
            text: "改",
            attr: { type: "button", "aria-label": "编辑任务" },
        });
        edit.addEventListener("click", (event) => {
            event.stopPropagation();
            this.editItemText(ref, item.id, row);
        });
        const remove = actions.createEl("button", {
            cls: "pb-item-action",
            text: "删",
            attr: { type: "button", "aria-label": "删除任务" },
        });
        remove.addEventListener("click", (event) => {
            event.stopPropagation();
            void this.deleteItem(ref, item.id);
        });

        row.addEventListener("click", (event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest(".pb-item-actions")) return;
            this.toggleItem(ref, item.id);
        });
        row.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.toggleItem(ref, item.id);
            }
        });

        this.itemEls.set(key, row);
    }

    private renderAddRow(container: HTMLElement, ref: DayRef, kind: ItemKind): void {
        const wrap = container.createDiv({ cls: "pb-add" });
        const input = wrap.createEl("input", {
            cls: "pb-add-input",
            attr: {
                type: "text",
                placeholder:
                    kind === "required"
                        ? "写一条必做任务，回车"
                        : "写一条学有余力任务，回车",
            },
        });
        const button = wrap.createEl("button", {
            cls: "pb-text-btn pb-primary",
            text: "添加",
            attr: { type: "button" },
        });
        const submit = (): void => {
            const text = input.value.trim();
            if (!text) return;
            input.value = "";
            this.pendingFocus = { path: ref.path, dayId: ref.day.id, kind };
            void this.addItem(ref, text, kind);
        };
        input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            event.stopPropagation();
            submit();
        });
        button.addEventListener("click", submit);
    }

    // --------------------------------------------------------------- actions

    private toggleItem(ref: DayRef, itemId: string): void {
        const item = ref.day.items.find((entry) => entry.id === itemId);
        if (!item) return;
        item.done = !item.done;
        if (item.done) item.doneAt = new Date().toISOString();
        else delete item.doneAt;
        const row = this.itemEls.get(itemKey(ref.path, item.id));
        if (row) {
            row.toggleClass("is-done", item.done);
            row.setAttribute("aria-checked", item.done ? "true" : "false");
        }
        this.updateProgress();
        void this.save(ref.path, ref.plan);
    }

    private async addItem(ref: DayRef, text: string, kind: ItemKind): Promise<void> {
        ref.day.items.push({ id: makeId("i"), text, kind, done: false });
        await this.save(ref.path, ref.plan);
        this.render();
    }

    private async updateItemText(
        ref: DayRef,
        itemId: string,
        text: string,
    ): Promise<void> {
        const item = ref.day.items.find((entry) => entry.id === itemId);
        if (!item) return;
        item.text = text;
        await this.save(ref.path, ref.plan);
        this.render();
    }

    private async deleteItem(ref: DayRef, itemId: string): Promise<void> {
        const index = ref.day.items.findIndex((entry) => entry.id === itemId);
        if (index < 0) return;
        ref.day.items.splice(index, 1);
        await this.save(ref.path, ref.plan);
        this.render();
    }

    private editPlanTitle(entry: LoadedPlan, element: HTMLElement): void {
        this.editInline(element, entry.plan.title, (value) => {
            entry.plan.title = value;
            entry.title = value;
            void this.save(entry.path, entry.plan).then(() => this.reload(true));
        });
    }

    private editDayTitle(ref: DayRef, element: HTMLElement): void {
        this.editInline(element, ref.day.title ?? "", (value) => {
            ref.day.title = value;
            void this.save(ref.path, ref.plan).then(() => this.render());
        });
    }

    private editItemText(ref: DayRef, itemId: string, row: HTMLElement): void {
        const textEl = row.querySelector<HTMLElement>(".pb-item-text");
        const item = ref.day.items.find((entry) => entry.id === itemId);
        if (!textEl || !item) return;
        this.editInline(textEl, item.text, (value) => {
            void this.updateItemText(ref, itemId, value);
        });
    }

    private editInline(
        element: HTMLElement,
        current: string,
        commit: (value: string) => void,
    ): void {
        const input = document.createElement("input");
        input.type = "text";
        input.value = current;
        input.className = "pb-inline-input";
        element.replaceWith(input);
        input.focus();
        input.select();

        let finished = false;
        const finish = (save: boolean): void => {
            if (finished) return;
            finished = true;
            const value = input.value.trim();
            if (save && value.length > 0 && value !== current) {
                commit(value);
            } else {
                this.render();
            }
        };

        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                finish(true);
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
            }
        });
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("click", (event) => event.stopPropagation());
    }

    private toggleCollapse(key: string): void {
        if (this.collapsed.has(key)) this.collapsed.delete(key);
        else this.collapsed.add(key);
        const els = this.dayEls.get(key);
        if (!els) return;
        const collapsed = this.collapsed.has(key);
        els.section.toggleClass("is-collapsed", collapsed);
        const head = els.section.querySelector<HTMLElement>(".pb-day-head");
        head?.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }

    private async deleteDay(ref: DayRef): Promise<void> {
        const index = ref.plan.days.findIndex((entry) => entry.id === ref.day.id);
        if (index < 0) return;
        ref.plan.days.splice(index, 1);
        this.collapsed.delete(dayKey(ref.path, ref.day.id));
        await this.save(ref.path, ref.plan);
        this.render();
    }

    private save(path: string, plan: Plan): Promise<void> {
        this.plugin.markWrite();
        this.saveChain = this.saveChain
            .then(() => this.plugin.storeFor(path).save(plan))
            .catch((error) => {
                new Notice(`保存计划失败：${String(error)}`);
            });
        return this.saveChain;
    }

    private updateProgress(): void {
        const radius = 22;
        const circumference = 2 * Math.PI * radius;
        const applyRing = (
            ring: SVGCircleElement | null,
            pctEl: HTMLElement | null,
            metaEl: HTMLElement | null,
            done: number,
            total: number,
        ): void => {
            const ratio = total > 0 ? done / total : 0;
            if (ring) {
                ring.style.strokeDashoffset = String(
                    circumference * (1 - ratio),
                );
            }
            pctEl?.setText(`${percent(done, total)}%`);
            metaEl?.setText(`${done}/${total}`);
        };

        let done = 0;
        let total = 0;
        for (const entry of this.visiblePlans) {
            const progress = planProgress(entry.plan);
            done += progress.done;
            total += progress.total;
        }
        applyRing(this.overallRing, this.overallPctEl, this.overallMetaEl, done, total);

        const today = todayISO();
        let todayDone = 0;
        let todayTotal = 0;
        for (const entry of this.visiblePlans) {
            for (const day of entry.plan.days) {
                if (day.date !== today) continue;
                todayTotal += day.items.length;
                todayDone += day.items.filter((item) => item.done).length;
            }
        }
        applyRing(this.todayRing, this.todayPctEl, this.todayMetaEl, todayDone, todayTotal);
        if (todayTotal === 0) this.todayMetaEl?.setText("今天没有任务");

        for (const entry of this.visiblePlans) {
            const row = this.planRows.get(entry.path);
            if (!row) continue;
            const progress = planProgress(entry.plan);
            row.bar.style.width = `${percent(progress.done, progress.total)}%`;
            row.pct.setText(`${percent(progress.done, progress.total)}%`);
            row.count.setText(`${progress.done}/${progress.total}`);
        }

        for (const entry of this.visiblePlans) {
            for (const day of entry.plan.days) {
                const els = this.dayEls.get(dayKey(entry.path, day.id));
                if (!els) continue;
                const progress = dayProgress(day);
                els.count.setText(`${progress.done}/${progress.total}`);
                els.bar.style.width = `${percent(progress.done, progress.total)}%`;
                const complete =
                    progress.total > 0 && progress.done === progress.total;
                els.section.toggleClass("is-done", complete);
                for (const [kind, group] of els.groups) {
                    const items = day.items.filter((item) => item.kind === kind);
                    const groupDone = items.filter((item) => item.done).length;
                    group.count.setText(`${groupDone}/${items.length}`);
                }
            }
        }

        for (const [date, cell] of this.calCells) {
            const refs = this.dayByDate.get(date) ?? [];
            let dateDone = 0;
            let dateTotal = 0;
            for (const ref of refs) {
                dateDone += ref.day.items.filter((item) => item.done).length;
                dateTotal += ref.day.items.length;
            }
            const radius = 13;
            const circumference = 2 * Math.PI * radius;
            const ratio = dateTotal > 0 ? dateDone / dateTotal : 0;
            cell.ring.style.strokeDashoffset = String(
                circumference * (1 - ratio),
            );
            const complete = dateTotal > 0 && dateDone === dateTotal;
            const overdue =
                dateTotal > 0 && dateDone < dateTotal && date < todayISO();
            const showRing =
                dateDone > 0 || complete || overdue || date === todayISO();
            cell.el.toggleClass("is-complete", complete);
            cell.el.toggleClass("is-overdue", overdue);
            cell.el.toggleClass("is-plain", !showRing);
        }
    }

    private restoreFocus(): void {
        const pending = this.pendingFocus;
        if (!pending) return;
        this.pendingFocus = null;
        const section = Array.from(
            this.contentEl.querySelectorAll<HTMLElement>("section.pb-day"),
        ).find(
            (element) =>
                element.dataset.day === pending.dayId &&
                element.dataset.path === pending.path,
        );
        section
            ?.querySelector<HTMLElement>(
                `.pb-group[data-kind="${pending.kind}"]`,
            )
            ?.querySelector<HTMLInputElement>(".pb-add-input")
            ?.focus();
    }

    private async deletePlan(entry: LoadedPlan): Promise<void> {
        try {
            await this.app.vault.adapter.remove(entry.path);
        } catch (error) {
            new Notice(`删除计划失败：${String(error)}`);
            return;
        }
        this.plans = this.plans.filter((item) => item.path !== entry.path);
        this.planOptions = this.planOptions.filter(
            (item) => item.path !== entry.path,
        );
        if (this.plugin.settings.planPath === entry.path) {
            const fallback = this.plans[0]?.path ?? DEFAULT_PLAN_PATH;
            this.plugin.settings.planPath = fallback;
            this.plugin.store.setPath(fallback);
            await this.plugin.saveSettings();
        }
        if (this.planFilter === entry.path) this.planFilter = null;
        this.selectedDate = null;
        this.collapsed.clear();
        new Notice(`已删除计划「${entry.title}」`);
        await this.reload(true);
    }

    private openNewPlanModal(): void {
        new NewPlanModal(this.app, (options) => {
            void this.plugin
                .createPlan(options)
                .then(async () => {
                    this.planFilter = null;
                    this.selectedDate = null;
                    this.collapsed.clear();
                    await this.reload(true);
                })
                .catch((error) => {
                    new Notice(`新建计划失败：${String(error)}`);
                });
        }).open();
    }
}
