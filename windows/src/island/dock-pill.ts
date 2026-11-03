// Fork: with the panel open, a small glass pill keeps Mochi in the taskbar corner,
// like the prototype's pill that stays put while the panel floats above it.
// Not clickable: the island takes the mouse over one rect only (the panel), so a
// click here falls through, like any click outside the open panel.

import { BotEngine } from "../mochi/engine";
import { h } from "../views/dom";
import { DOCKED } from "./dock";

/** Mochi's box in the compact pill: diameter 20 / 0.6 (botPosition in core/layout.ts). */
const W = 33;
const H = 32;

export class DockPill {
  readonly el = h("div", { id: "dock-pill" });
  private readonly canvas = h("canvas");
  private readonly engine = new BotEngine();
  private shown = false;

  constructor() {
    this.el.append(this.canvas);
    this.engine.still = true;
    this.engine.setState("idle", true);
  }

  /** Drawn once as it appears: a still Mochi costs nothing while the panel is open. */
  sync(open: boolean, color: BotEngine["bodyColor"]) {
    const on = DOCKED && open;
    if (on === this.shown) return;
    this.shown = on;
    this.el.classList.toggle("on", on);
    // The open panel keeps the original black (fork-island.css).
    document.documentElement.classList.toggle("docked-open", on);
    if (!on) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    this.engine.bodyColor = color;
    this.engine.update(0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.engine.draw(ctx, W, H);
  }
}
