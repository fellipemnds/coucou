// Fork: on Windows the window sits in the bottom-left corner of the taskbar
// (island_dock.rs), so the island is drawn at the window's bottom-left and opens upwards.

import { NOTCH_H, PANEL_H } from "../core/layout";

export const DOCKED = navigator.userAgent.includes("Windows");
if (DOCKED) document.documentElement.classList.add("docked");

const RESTING = new Set(["idle", "sleeping", "finished"]);

/**
 * The pill is always on screen, so its idle loops (breathing, z's) would draw
 * 60 frames a second forever: resting in the compact pill, Mochi holds still.
 */
export function restsStill(mode: string, state: string) {
  return DOCKED && mode === "compact" && RESTING.has(state);
}

const TONES: Partial<Record<string, string>> = {
  working: "working", thinking: "working", searching: "working",
  approval: "approval", question: "question", error: "error", ratelimit: "error", finished: "done",
};

/** The pill's look for Mochi's state (fork-island.css): only work moves, the alerts have their colour. */
export function dockTone(state: string) {
  return TONES[state] ?? "idle";
}

let tone = "";

/** Sets `data-dock` on the page when the tone changes, so the CSS restyles only then. */
export function setDockTone(state: string) {
  const t = dockTone(state);
  if (DOCKED && t !== tone) document.documentElement.dataset.dock = tone = t;
}

/** Open, the panel floats above the taskbar, clear of the pill: 32 px pill + 16. `LIFT` in island_dock.rs. */
export const LIFT = 48;

/** Island rect in window coordinates when docked. */
export function dockedRect(w: number, h: number) {
  const vh = window.innerHeight > 0 ? window.innerHeight : PANEL_H + LIFT;
  // The bottom edge rises with the first LIFT px of growth, so the morph stays continuous.
  const lift = Math.min(LIFT, Math.max(0, h - NOTCH_H));
  return { x: 0, y: vh - h - lift, w, h };
}

/**
 * Where the pointer counts as on the island. Open, the panel floats LIFT px above
 * the pill: the gap and the pill below count too, or moving from the pill to the
 * panel would leave it, and Open on hover would close it on the way.
 */
export function dockedHitRect(r: { x: number; y: number; w: number; h: number }) {
  const vh = window.innerHeight > 0 ? window.innerHeight : r.y + r.h;
  return { ...r, h: Math.max(r.h, vh - r.y) };
}

/** Places the island element at the bottom-left, every corner rounded. */
export function dockIsland(el: HTMLElement, w: number, h: number, r: number) {
  const rect = dockedRect(w, h);
  el.style.left = "0";
  el.style.top = `${rect.y}px`;
  el.style.transform = "none";
  el.style.borderRadius = `${r}px`;
  return rect;
}

/**
 * The compact island centres Mochi 40 px from the left and the agent grid 40 px
 * from the right, around the Mac's notch. In the taskbar there is no notch: the
 * pill is as wide as what it shows, Mochi's 64 px plus the gauge and the agents.
 */
export function dockedCompactW(gauge: boolean, agents: boolean) {
  const gaugeW = gauge ? 50 : 0; // the plan gauge with "100%"
  const right = gaugeW > 0 ? (agents ? 58 : 20) + gaugeW : agents ? 52 : 16;
  return 64 + right;
}
