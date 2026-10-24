import { App, Modal, Notice, Setting } from "obsidian";
import { daysBetweenISO, todayISO } from "./model";
import { buildMonthGrid, parseISODate, WEEKDAY_LABELS } from "./calendar";

export interface NewPlanOptions {
    title: string;
    startDate: string;
    endDate: string;
}

type DateField = "start" | "end";

export class NewPlanModal extends Modal {
    private title = "";
    private startDate = "";
    private endDate = "";
    private summaryEl: HTMLElement | null = null;
    private readonly triggers = new Map<DateField, HTMLButtonElement>();
    private openPopover: HTMLElement | null = null;
    private removeOutside: (() => void) | null = null;

    constructor(
        app: App,
        private readonly onSubmit: (options: NewPlanOptions) => void,
    ) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText("新建计划");

        new Setting(this.contentEl)
            .setName("计划名称")
            .addText((text) =>
                text.onChange((value) => {
                    this.title = value.trim();
                }),
            );

        const startSetting = new Setting(this.contentEl)
            .setName("开始日期")
            .setDesc("点击日期从日历里选择");
        this.addDateField(startSetting, "start");

        const endSetting = new Setting(this.contentEl)
            .setName("结束日期")
            .setDesc("含首尾两天；会生成这段日期的空清单。");
        this.addDateField(endSetting, "end");

        this.summaryEl = this.contentEl.createDiv({ cls: "pb-modal-summary" });
        this.refreshSummary();

        const footer = this.contentEl.createDiv({ cls: "modal-button-container" });
        footer
            .createEl("button", { text: "取消", attr: { type: "button" } })
            .addEventListener("click", () => this.close());
        const create = footer.createEl("button", {
            text: "创建",
            cls: "mod-cta",
            attr: { type: "button" },
        });
        create.addEventListener("click", () => {
            if (!this.title) {
                new Notice("请先填写计划名称");
                return;
            }
            if (!this.startDate || !this.endDate) {
                new Notice("请选择开始和结束日期");
                return;
            }
            if (this.endDate < this.startDate) {
                new Notice("结束日期不能早于开始日期");
                return;
            }
            this.close();
            this.onSubmit({
                title: this.title,
                startDate: this.startDate,
                endDate: this.endDate,
            });
        });
    }

    private addDateField(setting: Setting, field: DateField): void {
        const wrap = setting.controlEl.createDiv({ cls: "pb-date-field" });
        const trigger = wrap.createEl("button", {
            cls: "pb-date-trigger",
            text:
                this.value(field) ||
                (field === "start" ? "选择开始日期" : "选择结束日期"),
            attr: { type: "button", "aria-label": "选择日期" },
        });
        if (!this.value(field)) trigger.addClass("is-empty");
        this.triggers.set(field, trigger);
        trigger.addEventListener("click", (event) => {
            event.stopPropagation();
            this.togglePicker(wrap, field);
        });
    }

    private value(field: DateField): string {
        return field === "start" ? this.startDate : this.endDate;
    }

    private setValue(field: DateField, value: string): void {
        if (field === "start") this.startDate = value;
        else this.endDate = value;
        const trigger = this.triggers.get(field);
        trigger?.setText(value);
        trigger?.removeClass("is-empty");
        this.refreshSummary();
    }

    private togglePicker(anchor: HTMLElement, field: DateField): void {
        const wasOpenHere = this.openPopover !== null && this.openPopover.parentElement === anchor;
        this.closePicker();
        if (wasOpenHere) return;
        this.renderPicker(anchor, field);
    }

    private renderPicker(anchor: HTMLElement, field: DateField): void {
        const fallback =
            field === "end" && this.startDate
                ? parseISODate(this.startDate)
                : null;
        const selected = parseISODate(this.value(field)) ?? fallback ?? new Date();
        let year = selected.getFullYear();
        let month = selected.getMonth();

        const pop = anchor.createDiv({ cls: "pb-date-pop" });
        this.openPopover = pop;

        const head = pop.createDiv({ cls: "pb-date-pop-head" });
        const prev = head.createEl("button", {
            cls: "pb-date-nav",
            text: "‹",
            attr: { type: "button", "aria-label": "上个月" },
        });
        const label = head.createSpan({ cls: "pb-date-pop-title" });
        const next = head.createEl("button", {
            cls: "pb-date-nav",
            text: "›",
            attr: { type: "button", "aria-label": "下个月" },
        });

        const weekdays = pop.createDiv({ cls: "pb-date-pop-week" });
        for (const name of WEEKDAY_LABELS) {
            weekdays.createSpan({ cls: "pb-date-pop-weekday", text: name });
        }
        const grid = pop.createDiv({ cls: "pb-date-pop-grid" });

        const draw = (): void => {
            label.setText(`${year} 年 ${month + 1} 月`);
            grid.empty();
            for (const week of buildMonthGrid(year, month)) {
                for (const cell of week.cells) {
                    const button = grid.createEl("button", {
                        cls: "pb-date-day",
                        text: String(cell.day),
                        attr: { type: "button" },
                    });
                    if (!cell.inMonth) button.addClass("is-outside");
                    if (cell.date === this.value(field)) button.addClass("is-selected");
                    if (cell.date === todayISO()) button.addClass("is-today");
                    button.addEventListener("click", (event) => {
                        event.stopPropagation();
                        this.setValue(field, cell.date);
                        this.closePicker();
                    });
                }
            }
        };

        prev.addEventListener("click", (event) => {
            event.stopPropagation();
            month -= 1;
            if (month < 0) {
                month = 11;
                year -= 1;
            }
            draw();
        });
        next.addEventListener("click", (event) => {
            event.stopPropagation();
            month += 1;
            if (month > 11) {
                month = 0;
                year += 1;
            }
            draw();
        });

        const foot = pop.createDiv({ cls: "pb-date-pop-foot" });
        const today = foot.createEl("button", {
            cls: "pb-date-today",
            text: "今天",
            attr: { type: "button" },
        });
        today.addEventListener("click", (event) => {
            event.stopPropagation();
            this.setValue(field, todayISO());
            this.closePicker();
        });

        draw();

        const onOutside = (event: MouseEvent): void => {
            const target = event.target as Node | null;
            if (target && (pop.contains(target) || anchor.contains(target))) return;
            this.closePicker();
        };
        const onKey = (event: KeyboardEvent): void => {
            if (event.key === "Escape") this.closePicker();
        };
        window.setTimeout(() => {
            document.addEventListener("mousedown", onOutside);
            document.addEventListener("keydown", onKey);
        }, 0);
        this.removeOutside = () => {
            document.removeEventListener("mousedown", onOutside);
            document.removeEventListener("keydown", onKey);
        };
    }

    private closePicker(): void {
        this.removeOutside?.();
        this.removeOutside = null;
        this.openPopover?.remove();
        this.openPopover = null;
    }

    private refreshSummary(): void {
        if (!this.summaryEl) return;
        if (!this.startDate || !this.endDate) {
            this.summaryEl.setText("请选择开始和结束日期");
            return;
        }
        const count = daysBetweenISO(this.startDate, this.endDate);
        this.summaryEl.setText(
            count > 0 ? `共 ${count} 天` : "结束日期不能早于开始日期",
        );
    }

    onClose(): void {
        this.closePicker();
        this.contentEl.empty();
    }
}
