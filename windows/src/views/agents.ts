// Fork: the taskbar pill's agents panel (design/fork/taskbar-pill.html, version 11): the
// focused session's card with its steps, next to the live sessions or the permission card.
// A permission, a question, an end or an error takes the whole panel. Each is as tall as
// what it shows. Only docked; the overview falls back
// to the original's whenever the focused pill has no session.

import { h, clear } from "./dom";
import { State, type AgentTask } from "../core/state";
import { EXPANDED_W, PANEL_H, VIEW_LAYOUTS, type IslandViewName } from "../core/layout";
import { pillDefinition } from "../core/pills";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { hasSessionTicker, type ViewActions, type ViewHost } from "./views";
import { buildPlanPill, claudePillVisible, planCardOpen } from "./usage";
import { DOCKED, stepMarks, turnStartedAt } from "../island/dock";
import { t } from "../i18n/i18n";

/** Header (8 + 34) above the view, the bottom inset 10 below. */
const CHROME_H = 52;
/** The original's panel height. */
const MIN_H = 160;
/** Mochi in the session card's head: card at (10, 42), border 1 + inset 16, half his 24 px. */
const MOCHI = { botX: 39, botY: 71, botDiameter: 24 };
const STEPS_SHOWN = 5;
const ROWS_SHOWN = 4;
const UNDER_WAY = new Set(["working", "thinking", "searching", "approval", "question", "error", "ratelimit"]);

function agentsShown(): boolean {
  const task = State.focusTask;
  // The plan card opens in the original overview's left card.
  return DOCKED && task != null && hasSessionTicker(task) && !planCardOpen();
}

/** Texts the island already translates; work needs none, its step has the spinner. */
function stateLine(task: AgentTask): string {
  switch (task.state) {
    case "approval": return t("needs permission");
    case "question": return t("is asking a question");
    case "finished": return t("finished");
    case "error": return t("Session stopped on an error.");
    default: return "";
  }
}

const project = (task: AgentTask) => task.sessionCwd?.split(/[\\/]/).filter(Boolean).pop() ?? task.name;

function footLine(task: AgentTask): string {
  const agent = pillDefinition(task.id)?.name ?? task.name;
  // A Linux path: the session runs in WSL (the hook sends the cwd as the session sees it).
  return task.sessionCwd?.startsWith("/") ? `${agent} · WSL` : agent;
}

/** Minutes into the turn, while it runs; refreshed with each event, the island draws nothing in between. */
function elapsed(task: AgentTask): string {
  const start = turnStartedAt(task.id);
  if (start == null || !UNDER_WAY.has(task.state)) return "";
  return t("{0} min", { 0: Math.max(1, Math.round((Date.now() - start) / 60_000)) });
}

/** The focused session: Mochi (drawn by the island at MOCHI), project, state, time, steps, agent. */
function sessionCard() {
  const name = h("b");
  const status = h("span", { class: "ag-st" });
  const time = h("span", { class: "ag-t" });
  const steps = h("ol", { class: "ag-steps" });
  const foot = h("span", { class: "ag-foot" });
  const el = h("div", { class: "card ag-sess" },
    h("div", { class: "ag-head" }, h("span", { class: "ag-mochi" }), name, status, time), steps, foot);
  let key = "";
  return {
    el,
    render(task: AgentTask) {
      const since = elapsed(task);
      const k = [task.id, task.state, task.sessionCwd, since, ...task.steps.slice(-STEPS_SHOWN)].join("\u0000");
      if (k === key) return;
      key = k;
      el.dataset.state = task.state;
      name.textContent = project(task);
      status.textContent = stateLine(task);
      time.textContent = since;
      foot.textContent = footLine(task);
      clear(steps);
      for (const m of stepMarks(task.steps, task.state, STEPS_SHOWN)) {
        steps.append(h("li", { class: m.now ? "cur" : "ok", text: m.text }));
      }
    },
  };
}

/** The panel as tall as el's content, measured at the open panel's width (folded, the view is
 *  narrower). Measured when the view syncs, never per frame; the island animates to it. */
function fit(layout: { height: number }, el: HTMLElement) {
  const old = el.style.cssText;
  el.style.cssText += `;width:${EXPANDED_W - 20}px;right:auto;bottom:auto;height:auto`;
  const content = el.offsetHeight;
  el.style.cssText = old;
  if (content > 0) layout.height = Math.min(PANEL_H, Math.max(MIN_H, content + CHROME_H));
}

/** The island sizes the panel and places Mochi from VIEW_LAYOUTS: a getter follows which overview shows. */
function followLayout() {
  const base = { ...VIEW_LAYOUTS.overview };
  const agents = { ...base, ...MOCHI };
  Object.defineProperty(VIEW_LAYOUTS, "overview", { get: () => (agentsShown() ? agents : base) });
  return agents;
}

export function dockOverview(original: ViewHost, actions: ViewActions): ViewHost {
  if (!DOCKED) return original;
  const layout = followLayout();
  original.el.classList.remove("view");

  const session = sessionCard();
  const rows = h("div", { class: "ag-rows" });
  // The header's own plan pill (its look comes with .header-actions): a click opens the plan card.
  const plan = buildPlanPill(false);
  const planRow = h("div", { class: "header-actions ag-plan" }, plan.el);
  const agentsEl = h("div", { class: "agents" }, session.el, h("div", { class: "card ag-side" }, planRow, rows));
  const el = h("div", { class: "view" }, original.el, agentsEl);
  let rowsKey = "";

  function render() {
    const task = State.focusTask!;
    session.render(task);
    const planOn = claudePillVisible();
    planRow.style.display = planOn ? "" : "none";
    if (planOn) plan.sync();

    const live = State.tasks.filter(hasSessionTicker).slice(0, ROWS_SHOWN);
    const liveKey = live.map((x) => `${x.id}:${x.state}:${x.sessionCwd ?? ""}:${x.id === task.id}`).join("|");
    if (liveKey === rowsKey) return;
    rowsKey = liveKey;
    clear(rows);
    for (const x of live) {
      rows.append(h("button", { class: x.id === task.id ? "ag-row on" : "ag-row", onclick: () => actions.setFocus(x.id) },
        createMiniBot(x, 16),
        h("span", { class: "n", text: project(x) }),
        h("span", { class: "s", text: stateLine(x) }),
      ));
    }
    pruneMiniBots();
  }

  return {
    el,
    tick: (now) => (agentsShown() ? false : original.tick?.(now)),
    command(command) {
      if (!agentsShown()) original.command?.(command);
    },
    sync() {
      const on = agentsShown();
      original.el.style.display = on ? "none" : "";
      agentsEl.style.display = on ? "" : "none";
      original.sync();
      if (!on) return;
      render();
      fit(layout, agentsEl);
    },
  };
}

/** A permission, a question, an end or an error: the original card (its click guard, keys and
 *  decision) has the whole panel, Mochi centred at its left as in the original. */
export function dockFull(original: ViewHost, view: IslandViewName): ViewHost {
  if (!DOCKED) return original;
  original.el.classList.add("ag-full");
  return {
    ...original,
    sync() {
      original.sync();
      fit(VIEW_LAYOUTS[view], original.el);
    },
  };
}
