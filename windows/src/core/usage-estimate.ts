// Fork: the Claude plan usage estimated from Claude Code's session logs, for the
// Claude desktop app, which runs no status line (src-tauri/src/usage_estimate.rs).
// The logs give a cost; the user's calibration (the percent the Claude app showed
// at one moment) turns it into the PlanUsage the existing gauges already show.

import { effectivePct, type PlanUsage } from "./plan";

/** What `usage_estimate` returns; costs in API-equivalent US dollars. */
export interface UsageEstimate {
  fiveHour: { start: number; resetsAt: number; cost: number } | null;
  week: { start: number; cost: number };
  updatedAt: number;
}

export interface Calibration {
  /** What a full 5-hour window and a full week cost, in the estimate's dollars. */
  fiveHourLimit?: number;
  weekLimit?: number;
  /** One weekly reset (epoch ms); the others are whole weeks before or after it. */
  weekResetsAt: number;
  /** When it was taken (epoch ms). */
  at: number;
  /** The last 5-hour block Mochi asked about (its start). */
  askedStart?: number;
  /** The answer for that block: use from elsewhere (phone, other computers) and its real reset. */
  window?: { start: number; offsetPct: number; resetsAt?: number };
}

const WEEK_MS = 7 * 86_400_000;
const KEY = "coucou.usageEstimate";

/** The start of the week running at `now`, from any one weekly reset. */
export function weekStart(resetsAt: number, now: number): number {
  return resetsAt + Math.floor((now - resetsAt) / WEEK_MS) * WEEK_MS;
}

/**
 * The limits implied by the percents the Claude app shows, next to the costs of
 * the same moment. A percent of 0, or a window with no cost, keeps the old limit.
 */
export function calibrate(
  est: UsageEstimate, fivePct: number, weekPct: number, weekResetsAt: number, prev: Calibration | null, now: number,
): Calibration | null {
  const limit = (cost: number | undefined, pct: number, old?: number) =>
    cost && pct > 0 && pct <= 100 ? cost / (pct / 100) : old;
  const fiveHourLimit = limit(est.fiveHour?.cost, fivePct, prev?.fiveHourLimit);
  const weekLimit = limit(est.week.cost, weekPct, prev?.weekLimit);
  if (!fiveHourLimit && !weekLimit) return null;
  return { fiveHourLimit, weekLimit, weekResetsAt, at: now };
}

/** The estimate as the gauges' numbers. No running 5-hour block reads as 0 %. */
export function estimatedPlan(est: UsageEstimate, cal: Calibration): PlanUsage {
  const pct = (cost: number, limit: number, offset = 0) => Math.min(100, Math.max(0, (cost / limit) * 100 + offset));
  const usage: PlanUsage = { updatedAt: est.updatedAt };
  if (cal.fiveHourLimit) {
    // shortcut: past a reset the user gave, the gauge reads 0 until this computer's block ends; fine while that is rare.
    const w = est.fiveHour && cal.window?.start === est.fiveHour.start ? cal.window : undefined;
    usage.fiveHour = est.fiveHour
      ? { usedPct: pct(est.fiveHour.cost, cal.fiveHourLimit, w?.offsetPct), resetsAt: w?.resetsAt ?? est.fiveHour.resetsAt }
      : { usedPct: 0, resetsAt: 0 }; // a fixed past reset: no new numbers to keep or redraw
  }
  if (cal.weekLimit) {
    usage.sevenDay = { usedPct: pct(est.week.cost, cal.weekLimit), resetsAt: est.week.start + WEEK_MS };
  }
  return usage;
}

/** A 5-hour block that started after the calibration and was not asked about yet. */
export function shouldAsk(est: UsageEstimate, cal: Calibration): boolean {
  const start = est.fiveHour?.start;
  return start !== undefined && start > cal.at && start !== cal.askedStart;
}

/**
 * The answer to "new 5-hour window?": the percent the Claude app shows, past
 * what this computer's logs explain, is use from elsewhere.
 */
export function answerWindow(est: UsageEstimate, cal: Calibration, appPct: number, resetsAt?: number): Calibration {
  if (!est.fiveHour || !cal.fiveHourLimit) return cal;
  const local = (est.fiveHour.cost / cal.fiveHourLimit) * 100;
  return { ...cal, window: { start: est.fiveHour.start, offsetPct: Math.max(0, appPct - local), resetsAt } };
}

/** "HH:MM" → the next such time within 5 hours of `now`, else undefined. */
export function resetFromTime(time: string, now: number): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return undefined;
  const d = new Date(now);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  const at = d.getTime() <= now ? d.getTime() + 86_400_000 : d.getTime();
  return at - now <= 5 * 3_600_000 ? at : undefined;
}

/** Alert levels, highest first. */
const LEVELS = [95, 80];

/**
 * The level a window has just reached, once per window and level: `alerted`
 * maps a window's reset time to the highest level already told.
 */
export function crossedLevel(
  usage: PlanUsage, alerted: Record<string, number>, now = Date.now(),
): { key: string; level: number } | null {
  for (const w of [usage.fiveHour, usage.sevenDay]) {
    if (!w) continue;
    const level = LEVELS.find((l) => effectivePct(w, now) >= l); // what the gauges show
    const key = String(w.resetsAt);
    if (level && (alerted[key] ?? 0) < level) return { key, level };
  }
  return null;
}

export function loadCalibration(): Calibration | null {
  try {
    const c = JSON.parse(window.localStorage?.getItem(KEY) ?? "null") as Calibration | null;
    return c && typeof c.weekResetsAt === "number" && (c.fiveHourLimit || c.weekLimit) ? c : null;
  } catch {
    return null;
  }
}

export const estimateCalibrated = (): boolean => loadCalibration() !== null;

export function saveCalibration(c: Calibration): void {
  try {
    window.localStorage?.setItem(KEY, JSON.stringify(c));
  } catch {
    // Storage off or full: the calibration just will not outlive this run.
  }
}
