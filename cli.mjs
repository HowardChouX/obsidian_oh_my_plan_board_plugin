#!/usr/bin/env node
/**
 * Plan Board CLI — reads and writes the same JSON file as the Obsidian plugin.
 *
 * Usage:
 *   node cli.mjs --vault <vault> [--plan .plan-board/plan.json] <command> [...]
 *
 * Commands: summary, show, init, add-day, add-item, update-item,
 *           toggle, check, uncheck, delete-item, delete-day, set-title,
 *           import, export, help
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DEFAULT_PLAN = ".plan-board/plan.json";

// ---------------------------------------------------------------- utilities

function fail(message) {
    process.stderr.write(`${message}\n`);
    process.exit(1);
}

function parseArgs(argv) {
    const opts = {};
    const positional = [];
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === undefined) continue;
        if (arg.startsWith("--")) {
            const body = arg.slice(2);
            const eq = body.indexOf("=");
            if (eq >= 0) {
                opts[body.slice(0, eq)] = body.slice(eq + 1);
            } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) {
                opts[body] = argv[i + 1];
                i += 1;
            } else {
                opts[body] = true;
            }
        } else {
            positional.push(arg);
        }
    }
    return { opts, positional };
}

function pad(value) {
    return String(value).padStart(2, "0");
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysISO(base, days) {
    const [y, m, d] = base.split("-").map(Number);
    const date = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function resolveVault(opts) {
    const vault = path.resolve(
        String(opts.vault ?? process.env.OBSIDIAN_VAULT ?? ""),
    );
    if (!opts.vault && !process.env.OBSIDIAN_VAULT) {
        fail("缺少 --vault <Vault 路径>（或设置 OBSIDIAN_VAULT）");
    }
    if (!fs.existsSync(vault) || !fs.statSync(vault).isDirectory()) {
        fail(`Vault 目录不存在：${vault}`);
    }
    return vault;
}

function resolvePlan(opts, vault) {
    const rel = String(opts.plan ?? DEFAULT_PLAN);
    if (path.isAbsolute(rel)) fail("--plan 必须是相对于 Vault 的路径");
    const full = path.resolve(vault, rel);
    if (full !== vault && !full.startsWith(vault + path.sep)) {
        fail("--plan 不能跳出 Vault 目录");
    }
    return { rel, full };
}

// ------------------------------------------------------------------ normalise

function normaliseItem(raw, index, dayId) {
    if (typeof raw === "string") {
        return {
            id: `${dayId}-${index + 1}`,
            text: raw,
            kind: "required",
            done: false,
        };
    }
    const rec = raw && typeof raw === "object" ? raw : {};
    const text = String(rec.text ?? "").trim();
    return {
        id:
            typeof rec.id === "string" && rec.id.trim()
                ? rec.id.trim()
                : `${dayId}-${index + 1}`,
        text,
        kind: rec.kind === "optional" ? "optional" : "required",
        done: rec.done === true,
        ...(typeof rec.doneAt === "string" ? { doneAt: rec.doneAt } : {}),
    };
}

function normalisePlan(raw, fallbackTitle = "未命名计划") {
    const source = raw && typeof raw === "object" ? raw : {};
    const rawStart =
        typeof source.startDate === "string" && source.startDate.trim()
            ? source.startDate.trim()
            : "";
    const rawDays = Array.isArray(source.days) ? source.days : [];
    const seenDays = new Set();
    const days = rawDays.map((rawDay, index) => {
        const rec = rawDay && typeof rawDay === "object" ? rawDay : {};
        let id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `d${index + 1}`;
        while (seenDays.has(id)) id = `${id}-${index + 1}`;
        seenDays.add(id);

        const collected = [];
        if (Array.isArray(rec.items)) collected.push(...rec.items);
        if (Array.isArray(rec.required)) {
            collected.push(...rec.required.map((text) => ({ text, kind: "required" })));
        }
        if (Array.isArray(rec.optional)) {
            collected.push(...rec.optional.map((text) => ({ text, kind: "optional" })));
        }

        const seenItems = new Set();
        const items = collected.map((rawItem, itemIndex) => {
            const item = normaliseItem(rawItem, itemIndex, id);
            let itemId = item.id;
            while (seenItems.has(itemId)) itemId = `${itemId}-${itemIndex + 1}`;
            seenItems.add(itemId);
            return { ...item, id: itemId };
        });

        return {
            id,
            label:
                typeof rec.label === "string" && rec.label.trim()
                    ? rec.label.trim()
                    : `Day ${index + 1}`,
            ...(typeof rec.date === "string" && rec.date.trim()
                ? { date: rec.date.trim() }
                : rawStart
                  ? { date: addDaysISO(rawStart, index) }
                  : {}),
            ...(typeof rec.title === "string" && rec.title.trim()
                ? { title: rec.title.trim() }
                : {}),
            items,
        };
    });

    const stamp = new Date().toISOString();
    return {
        version: 1,
        title:
            typeof source.title === "string" && source.title.trim()
                ? source.title.trim()
                : fallbackTitle,
        ...(typeof source.subtitle === "string" && source.subtitle.trim()
            ? { subtitle: source.subtitle.trim() }
            : {}),
        ...(rawStart ? { startDate: rawStart } : {}),
        createdAt: typeof source.createdAt === "string" ? source.createdAt : stamp,
        updatedAt: stamp,
        days,
    };
}

// ---------------------------------------------------------------------- io

function readPlan(fullPath, fallbackTitle) {
    if (!fs.existsSync(fullPath)) {
        return normalisePlan({ title: fallbackTitle, days: [] }, fallbackTitle);
    }
    const text = fs.readFileSync(fullPath, "utf8");
    let raw;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        fail(`计划文件不是合法 JSON：${fullPath}\n${String(error)}`);
    }
    return normalisePlan(raw, fallbackTitle);
}

function writePlan(fullPath, plan) {
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    plan.updatedAt = new Date().toISOString();
    fs.writeFileSync(fullPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
}

// ---------------------------------------------------------------- progress

function progressOf(items) {
    let done = 0;
    let requiredDone = 0;
    let requiredTotal = 0;
    for (const item of items) {
        if (item.done) done += 1;
        if (item.kind === "required") {
            requiredTotal += 1;
            if (item.done) requiredDone += 1;
        }
    }
    return { done, total: items.length, requiredDone, requiredTotal };
}

function pct(done, total) {
    return total === 0 ? 0 : Math.round((done / total) * 100);
}

function planSummary(plan) {
    const all = plan.days.flatMap((day) => day.items);
    const total = progressOf(all);
    return {
        ...total,
        percent: pct(total.done, total.total),
        days: plan.days.length,
        daysDone: plan.days.filter((day) => {
            const p = progressOf(day.items);
            return p.total > 0 && p.done === p.total;
        }).length,
    };
}

// --------------------------------------------------------------- resolving

function resolveDay(plan, ref) {
    if (ref === undefined) fail("缺少 --day <id|序号|标签>");
    const needle = String(ref).trim().toLowerCase();
    let day = plan.days.find((entry) => entry.id.toLowerCase() === needle);
    if (!day) day = plan.days.find((entry) => entry.label.toLowerCase() === needle);
    if (!day) {
        const index = Number(needle);
        if (Number.isInteger(index) && index >= 1 && index <= plan.days.length) {
            day = plan.days[index - 1];
        }
    }
    if (!day) fail(`找不到这一天：${ref}`);
    return day;
}

function resolveItem(day, ref) {
    if (ref === undefined) fail("缺少 --item <id|序号>");
    const needle = String(ref).trim().toLowerCase();
    let item = day.items.find((entry) => entry.id.toLowerCase() === needle);
    if (!item) {
        const index = Number(needle);
        if (Number.isInteger(index) && index >= 1 && index <= day.items.length) {
            item = day.items[index - 1];
        }
    }
    if (!item) fail(`找不到这个任务：${ref}`);
    return item;
}

// ------------------------------------------------------------------ output

function printSummary(plan, file) {
    const summary = planSummary(plan);
    process.stdout.write(`${plan.title}\n`);
    process.stdout.write(
        `${file}  ${summary.done}/${summary.total} (${summary.percent}%)  必做 ${summary.requiredDone}/${summary.requiredTotal}  完成 ${summary.daysDone}/${summary.days} 天\n\n`,
    );
    for (const day of plan.days) {
        const p = progressOf(day.items);
        const title = day.title ? `  ${day.title}` : "";
        const date = day.date ? `  ${day.date}` : "";
        process.stdout.write(
            `${day.label.padEnd(7)} ${String(p.done).padStart(3)}/${String(p.total).padEnd(3)} ${String(pct(p.done, p.total)).padStart(3)}%${date}${title}\n`,
        );
    }
}

function printDay(day) {
    process.stdout.write(`${day.label}${day.title ? ` · ${day.title}` : ""}${day.date ? `  ${day.date}` : ""}\n`);
    for (const [index, item] of day.items.entries()) {
        const mark = item.done ? "x" : " ";
        const kind = item.kind === "optional" ? "[选做]" : "[必做]";
        process.stdout.write(
            `${String(index + 1).padStart(2)}. [${mark}] ${kind} ${item.text}\n`,
        );
    }
}

// ----------------------------------------------------------------- commands

function cmdInit(opts, vault, planFile) {
    if (fs.existsSync(planFile.full)) fail(`计划文件已存在：${planFile.full}`);
    const plan = normalisePlan(
        {
            title: opts.title ?? "未命名计划",
            ...(opts.subtitle ? { subtitle: opts.subtitle } : {}),
            ...(opts.start ? { startDate: opts.start } : {}),
            days: [],
        },
        "未命名计划",
    );
    writePlan(planFile.full, plan);
    process.stdout.write(`已创建 ${planFile.rel}\n`);
}

function cmdAddDay(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const index = plan.days.length;
    const last = plan.days[index - 1];
    const start = plan.startDate ?? last?.date ?? todayISO();
    const day = {
        id: makeId("d"),
        label: String(opts.label ?? `Day ${index + 1}`),
        date: String(opts.date ?? (plan.startDate ? addDaysISO(plan.startDate, index) : addDaysISO(start, index === 0 ? 0 : 1))),
        ...(opts.title ? { title: String(opts.title) } : {}),
        items: [],
    };
    plan.days.push(day);
    writePlan(planFile.full, plan);
    process.stdout.write(`已新增 ${day.label}${day.date ? ` (${day.date})` : ""}  id=${day.id}\n`);
}

function cmdAddItem(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const day = resolveDay(plan, opts.day);
    const text = String(opts.text ?? "").trim();
    if (!text) fail("缺少 --text");
    const kind = opts.kind === "optional" ? "optional" : "required";
    const item = { id: makeId("i"), text, kind, done: false };
    day.items.push(item);
    writePlan(planFile.full, plan);
    process.stdout.write(`已添加 ${day.label} ${kind === "optional" ? "选做" : "必做"}：${text}\n`);
}

function cmdUpdateItem(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const day = resolveDay(plan, opts.day);
    const item = resolveItem(day, opts.item);
    if (opts.text !== undefined) item.text = String(opts.text).trim();
    if (opts.kind !== undefined) item.kind = opts.kind === "optional" ? "optional" : "required";
    writePlan(planFile.full, plan);
    process.stdout.write(`已更新：${item.text}\n`);
}

function cmdToggle(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const day = resolveDay(plan, opts.day);
    const item = resolveItem(day, opts.item);
    if (opts.on === true) item.done = true;
    else if (opts.off === true) item.done = false;
    else item.done = !item.done;
    if (item.done) item.doneAt = new Date().toISOString();
    else delete item.doneAt;
    writePlan(planFile.full, plan);
    process.stdout.write(`${item.done ? "已完成" : "已取消"}：${item.text}\n`);
}

function cmdDeleteItem(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const day = resolveDay(plan, opts.day);
    const item = resolveItem(day, opts.item);
    day.items = day.items.filter((entry) => entry.id !== item.id);
    writePlan(planFile.full, plan);
    process.stdout.write(`已删除：${item.text}\n`);
}

function cmdDeleteDay(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const day = resolveDay(plan, opts.day);
    plan.days = plan.days.filter((entry) => entry.id !== day.id);
    writePlan(planFile.full, plan);
    process.stdout.write(`已删除 ${day.label}\n`);
}

function cmdSetTitle(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    const title = String(opts.title ?? "").trim();
    if (!title) fail("缺少 --title");
    plan.title = title;
    writePlan(planFile.full, plan);
    process.stdout.write(`标题已改为：${title}\n`);
}

function cmdImport(opts, vault, planFile) {
    if (!opts.file) fail("缺少 --file <计划 JSON>");
    const source = fs.readFileSync(path.resolve(String(opts.file)), "utf8");
    let raw;
    try {
        raw = JSON.parse(source);
    } catch (error) {
        fail(`导入文件不是合法 JSON：${String(error)}`);
    }
    const incoming = normalisePlan(raw);
    if (opts.merge === true && fs.existsSync(planFile.full)) {
        const current = readPlan(planFile.full);
        for (const day of incoming.days) {
            const index = current.days.findIndex(
                (entry) => entry.id === day.id || entry.label === day.label,
            );
            if (index >= 0) current.days[index] = day;
            else current.days.push(day);
        }
        if (opts.title !== undefined) current.title = String(opts.title);
        writePlan(planFile.full, current);
        process.stdout.write(
            `已合并 ${incoming.days.length} 天到 ${planFile.rel}\n`,
        );
        return;
    }
    writePlan(planFile.full, incoming);
    process.stdout.write(
        `已写入 ${incoming.days.length} 天、${incoming.days.reduce((n, day) => n + day.items.length, 0)} 项到 ${planFile.rel}\n`,
    );
}

function cmdReflow(opts, vault, planFile) {
    const start = String(opts.start ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        fail("缺少或格式错误的 --start YYYY-MM-DD");
    }
    const plan = readPlan(planFile.full);
    plan.startDate = start;
    plan.days.forEach((day, index) => {
        day.date = addDaysISO(start, index);
    });
    writePlan(planFile.full, plan);
    const last = plan.days[plan.days.length - 1]?.date ?? start;
    process.stdout.write(
        `已重排 ${plan.days.length} 天：${start} → ${last}\n`,
    );
}

function cmdExport(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function cmdSummary(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    if (opts.json === true) {
        const summary = planSummary(plan);
        process.stdout.write(
            `${JSON.stringify(
                {
                    path: planFile.rel,
                    title: plan.title,
                    progress: summary,
                    days: plan.days.map((day) => ({
                        id: day.id,
                        label: day.label,
                        date: day.date ?? null,
                        title: day.title ?? null,
                        ...progressOf(day.items),
                        percent: pct(
                            progressOf(day.items).done,
                            progressOf(day.items).total,
                        ),
                    })),
                },
                null,
                2,
            )}\n`,
        );
        return;
    }
    printSummary(plan, planFile.rel);
}

function cmdShow(opts, vault, planFile) {
    const plan = readPlan(planFile.full);
    if (opts.day !== undefined) {
        printDay(resolveDay(plan, opts.day));
        return;
    }
    for (const day of plan.days) {
        printDay(day);
        process.stdout.write("\n");
    }
}

function usage() {
    process.stdout.write(`Plan Board CLI

用法:
  node cli.mjs --vault <Vault 路径> [--plan <相对路径>] <命令> [参数]

命令:
  summary [--json]                         总体与每天进度
  show [--day <id|序号|标签>]              查看任务明细
  init --title <标题> [--start <YYYY-MM-DD>] [--subtitle <副标题>]
  add-day [--label "Day 21"] [--date <YYYY-MM-DD>] [--title <标题>]
  add-item --day <id|序号> --text <任务> [--kind required|optional]
  update-item --day <id|序号> --item <id|序号> [--text <任务>] [--kind ...]
  toggle --day <id|序号> --item <id|序号> [--on|--off]
  check / uncheck  同上
  delete-item --day <id|序号> --item <id|序号>
  delete-day --day <id|序号>
  set-title --title <标题>
  reflow --start <YYYY-MM-DD>              从指定日期起逐天重排日期
  import --file <计划 JSON> [--merge]
  export                                   输出完整 JSON

示例:
  node cli.mjs --vault ~/obsidian_study_notes summary
  node cli.mjs --vault ~/obsidian_study_notes add-item --day 1 --text "做 3 道极限题"
  node cli.mjs --vault ~/obsidian_study_notes import --file seed.json
`);
}

// -------------------------------------------------------------------- main

const { opts, positional } = parseArgs(process.argv.slice(2));
const command = positional[0] ?? "summary";

if (command === "help" || opts.help === true) {
    usage();
    process.exit(0);
}

const vault = resolveVault(opts);
const planFile = resolvePlan(opts, vault);

switch (command) {
    case "summary":
    case "list":
        cmdSummary(opts, vault, planFile);
        break;
    case "show":
        cmdShow(opts, vault, planFile);
        break;
    case "init":
        cmdInit(opts, vault, planFile);
        break;
    case "add-day":
        cmdAddDay(opts, vault, planFile);
        break;
    case "add-item":
        cmdAddItem(opts, vault, planFile);
        break;
    case "update-item":
        cmdUpdateItem(opts, vault, planFile);
        break;
    case "toggle":
        cmdToggle(opts, vault, planFile);
        break;
    case "check":
        cmdToggle({ ...opts, on: true }, vault, planFile);
        break;
    case "uncheck":
        cmdToggle({ ...opts, off: true }, vault, planFile);
        break;
    case "delete-item":
        cmdDeleteItem(opts, vault, planFile);
        break;
    case "delete-day":
        cmdDeleteDay(opts, vault, planFile);
        break;
    case "set-title":
        cmdSetTitle(opts, vault, planFile);
        break;
    case "reflow":
        cmdReflow(opts, vault, planFile);
        break;
    case "import":
        cmdImport(opts, vault, planFile);
        break;
    case "export":
        cmdExport(opts, vault, planFile);
        break;
    default:
        fail(`未知命令：${command}\n运行 node cli.mjs help 查看用法`);
}
