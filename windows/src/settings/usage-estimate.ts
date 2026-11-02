// Fork: calibrating the plan usage estimate (core/usage-estimate.ts) in
// Settings → Plan usage, for people who use Claude Code from the desktop app.

import { Bridge } from "../core/bridge";
import { calibrate, loadCalibration, saveCalibration, weekStart } from "../core/usage-estimate";
import { t } from "../i18n/i18n";
import { h } from "../views/dom";

const WEEK_MS = 7 * 86_400_000;

/** Epoch ms → the local "YYYY-MM-DDTHH:mm" a datetime-local input takes. */
const localInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** The hint, the fields and the button; `changed` runs once a calibration is saved. */
export function estimateRows(changed: () => void): HTMLElement[] {
  const prev = loadCalibration();
  const pct = () => h("input", { type: "number", min: "0", max: "100", step: "1", style: "width:64px" }) as HTMLInputElement;
  const five = pct();
  const week = pct();
  const reset = h("input", { type: "datetime-local" }) as HTMLInputElement;
  if (prev) reset.value = localInput(weekStart(prev.weekResetsAt, Date.now()) + WEEK_MS);
  const status = h("span", {
    class: "hint",
    text: prev ? t("Calibrated {date}", { date: new Date(prev.at).toLocaleString() }) : t("Not calibrated"),
  });
  const button = h("button", {
    class: "primary",
    text: t("Calibrate"),
    onclick: async () => {
      // A datetime-local value has no offset: Date.parse reads it as local time.
      const resetsAt = Date.parse(reset.value);
      if (!Number.isFinite(resetsAt)) {
        reset.focus();
        return;
      }
      const now = Date.now();
      const est = await Bridge.usageEstimate(weekStart(resetsAt, now));
      const cal = est && calibrate(est, Number(five.value), Number(week.value), resetsAt, loadCalibration(), now);
      if (!cal) {
        status.textContent = t("No recent activity in the session logs to calibrate against.");
        return;
      }
      saveCalibration(cal);
      changed();
    },
  });
  return [
    h("div", { class: "hint", text: t("Only the desktop app? Coucou can estimate the usage from your session logs. Type what the Claude app shows now (Settings → Usage) to calibrate it; do it again now and then to stay close.") }),
    h("div", { class: "row" }, h("label", { text: t("5-hour limit (%)") }), five),
    h("div", { class: "row" }, h("label", { text: t("Weekly limit (%)") }), week),
    h("div", { class: "row" }, h("label", { text: t("Weekly reset") }), reset),
    h("div", { class: "row" }, button, status),
  ];
}
