// Fork: keeps the estimated Claude plan usage (core/usage-estimate.ts) fresh.
// Called where the Claude gauges are drawn, so it never runs while the island
// is hidden; the logs are read again at most every 30 seconds.

import { Bridge } from "../core/bridge";
import type { PlanUsage } from "../core/plan";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import {
  answerWindow, crossedLevel, estimatedPlan, loadCalibration, resetFromTime, saveCalibration, shouldAsk, weekStart,
  type UsageEstimate,
} from "../core/usage-estimate";
import { setClaudePlanUsage } from "./usage";

const EVERY_MS = 30_000;
const ALERT_KEY = "coucou.usageEstimateAlert";
let inFlight = false;
let last = 0;
let lastEstimate: UsageEstimate | null = null;

/** Opens the Claude plan card (the island must be on the overview). */
export function openClaudePlanCard(): void {
  State.planDetailIsCodex = false;
  State.showingPlanDetail = true;
  State.notify();
}

/**
 * Only once calibrated, and never over a status line's real numbers. `show`
 * opens "windowCheck" when a new 5-hour block starts, and the overview (the
 * plan card) when a window reaches 80 % or 95 %.
 */
export function refreshUsageEstimate(show: (view: "overview" | "windowCheck") => void, now = Date.now()): void {
  const cal = loadCalibration();
  if (!cal || inFlight || State.settings.planRelayInstalled || now - last < EVERY_MS) return;
  inFlight = true;
  last = now;
  void Bridge.usageEstimate(weekStart(cal.weekResetsAt, now))
    .then((est) => {
      if (!est) return;
      lastEstimate = est;
      const usage = estimatedPlan(est, cal);
      setClaudePlanUsage(usage);
      if (shouldAsk(est, cal)) {
        saveCalibration({ ...cal, askedStart: est.fiveHour?.start });
        Sound.play("question");
        show("windowCheck");
      } else if (tellOnce(usage)) {
        Sound.play("error");
        show("overview");
      }
    })
    .finally(() => {
      inFlight = false;
    });
}

/** "New 5-hour window?" answered: the app's percent and, if given, its reset time ("HH:MM"). */
export function answerWindowCheck(appPct: number, time: string, now = Date.now()): void {
  const cal = loadCalibration();
  if (!cal || !lastEstimate) return;
  const next = answerWindow(lastEstimate, cal, appPct, resetFromTime(time, now));
  saveCalibration(next);
  setClaudePlanUsage(estimatedPlan(lastEstimate, next));
}

/** True when a level was just reached; it is then marked as told. */
function tellOnce(usage: PlanUsage): boolean {
  let alerted: Record<string, number> = {};
  try {
    alerted = JSON.parse(window.localStorage?.getItem(ALERT_KEY) ?? "{}") ?? {};
  } catch {
    // Nothing kept: at worst a level is told again.
  }
  const hit = crossedLevel(usage, alerted);
  if (!hit) return false;
  // Only the running windows are kept.
  const keep = [usage.fiveHour, usage.sevenDay].map((w) => String(w?.resetsAt));
  const next = Object.fromEntries(Object.entries(alerted).filter(([k]) => keep.includes(k)));
  next[hit.key] = hit.level;
  try {
    window.localStorage?.setItem(ALERT_KEY, JSON.stringify(next));
  } catch {
    // Storage off: the level may be told again next time.
  }
  return true;
}
