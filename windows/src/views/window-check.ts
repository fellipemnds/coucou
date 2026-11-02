// Fork: "New 5-hour window" — asked once when this computer starts a new block
// (views/usage-estimate.ts). The percent the Claude app shows counts use from
// the phone or other computers, which this computer's logs cannot see. Same
// card, inset and buttons as the update card.

import { h } from "./dom";
import { washRGBA } from "../core/layout";
import { answerWindowCheck, openClaudePlanCard } from "./usage-estimate";
import type { ViewActions, ViewHost } from "./views";
import { t } from "../i18n/i18n";

const FIELD = "border:0;border-radius:8px;padding:5px 8px;background:rgba(255,255,255,0.08);color:var(--ink);font:400 13px var(--font);color-scheme:dark;outline:none";

function btn(label: string, kind: "primary" | "secondary", onClick: () => void): HTMLButtonElement {
  return h("button", { class: `btn ${kind}`, onclick: onClick }, h("span", { text: label }));
}

export function buildWindowCheck(actions: ViewActions): ViewHost {
  const pct = h("input", { type: "number", min: "0", max: "100", step: "1", placeholder: "%", style: `${FIELD};width:52px` }) as HTMLInputElement;
  const time = h("input", { type: "time", style: FIELD }) as HTMLInputElement;
  const title = h("div", { class: "title one-line" });
  const line = h("div", { class: "sub update-line" });
  const save = btn("", "primary", () => {
    answerWindowCheck(Number(pct.value) || 0, time.value);
    done();
  });
  const now = btn("", "secondary", () => done());
  const row = h("div", { class: "actions" }, pct, time, save, now);
  const stack = h("div", { class: "stack" }, title, line, row);
  stack.style.padding = "4px 16px 4px 116px";
  const card = h("div", { class: "card wash" }, stack);
  card.style.setProperty("--wash", washRGBA("amber"));

  function done() {
    pct.value = "";
    time.value = "";
    actions.setView("overview");
    openClaudePlanCard();
  }

  return {
    el: h("div", { class: "view" }, card),
    sync() {
      title.textContent = t("New 5-hour window");
      line.textContent = t("What does the Claude app show now? Use on your phone or another computer counts there, not here.");
      save.firstElementChild!.textContent = t("Save");
      now.firstElementChild!.textContent = t("Started just now");
    },
  };
}
