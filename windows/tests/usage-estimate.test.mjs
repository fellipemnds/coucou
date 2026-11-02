// Fork: the plan usage estimated from the session logs (src/core/usage-estimate.ts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { answerWindow, calibrate, crossedLevel, estimatedPlan, resetFromTime, shouldAsk, weekStart } from "../src/core/usage-estimate.ts";

const H = 3_600_000;
const WEEK = 168 * H;

test("the week runs from the last reset before now, from any known reset", () => {
  const reset = 1_000 * WEEK + 8 * H;
  assert.equal(weekStart(reset, reset + H), reset);
  assert.equal(weekStart(reset, reset - H), reset - WEEK);
  assert.equal(weekStart(reset + 3 * WEEK, reset + H), reset);
});

test("a calibration turns the logs' cost into the percent the Claude app showed", () => {
  const est = { fiveHour: { start: 0, resetsAt: 5 * H, cost: 18 }, week: { start: -WEEK + 6 * H, cost: 40 }, updatedAt: H };
  const cal = calibrate(est, 50, 32, 6 * H, null, H);
  assert.equal(cal.fiveHourLimit, 36);
  assert.equal(cal.weekLimit, 125);
  const later = { ...est, fiveHour: { ...est.fiveHour, cost: 27 } };
  const plan = estimatedPlan(later, cal);
  assert.equal(plan.fiveHour.usedPct, 75);
  assert.equal(plan.fiveHour.resetsAt, 5 * H);
  assert.equal(plan.sevenDay.usedPct, 32);
  assert.equal(plan.sevenDay.resetsAt, 6 * H);
  // Past the limit the gauge stops at 100; no running block reads as 0.
  assert.equal(estimatedPlan({ ...est, fiveHour: { ...est.fiveHour, cost: 99 } }, cal).fiveHour.usedPct, 100);
  assert.deepEqual(estimatedPlan({ ...est, fiveHour: null }, cal).fiveHour, { usedPct: 0, resetsAt: 0 }); // same every read
});

test("a window left at 0 % or with no cost keeps its old limit", () => {
  const est = { fiveHour: null, week: { start: 0, cost: 40 }, updatedAt: H };
  const prev = { fiveHourLimit: 36, weekLimit: 100, weekResetsAt: 0, at: 0 };
  assert.deepEqual(calibrate(est, 20, 0, 0, prev, H), { fiveHourLimit: 36, weekLimit: 100, weekResetsAt: 0, at: H });
  assert.equal(calibrate(est, 0, 0, 0, null, H), null);
});

test("80 % and 95 % are told once per window", () => {
  const usage = (five, week) => ({ fiveHour: { usedPct: five, resetsAt: 5 * H }, sevenDay: { usedPct: week, resetsAt: WEEK }, updatedAt: 0 });
  assert.equal(crossedLevel(usage(79, 10), {}, 0), null);
  assert.deepEqual(crossedLevel(usage(81, 10), {}, 0), { key: String(5 * H), level: 80 });
  assert.equal(crossedLevel(usage(90, 10), { [5 * H]: 80 }, 0), null);
  assert.deepEqual(crossedLevel(usage(96, 10), { [5 * H]: 80 }, 0), { key: String(5 * H), level: 95 });
  assert.deepEqual(crossedLevel(usage(10, 85), { [5 * H]: 95 }, 0), { key: String(WEEK), level: 80 });
  // A window already reset reads 0 on the gauges, so it tells nothing either.
  assert.equal(crossedLevel(usage(99, 10), {}, 6 * H), null);
});

test("a new 5-hour block is asked about once; the answer adds what the logs cannot see", () => {
  const est = { fiveHour: { start: 10 * H, resetsAt: 15 * H, cost: 3.6 }, week: { start: 0, cost: 40 }, updatedAt: 11 * H };
  const cal = { fiveHourLimit: 36, weekLimit: 100, weekResetsAt: WEEK, at: 5 * H };
  assert.equal(shouldAsk(est, cal), true);
  assert.equal(shouldAsk(est, { ...cal, askedStart: 10 * H }), false);
  assert.equal(shouldAsk(est, { ...cal, at: 10.5 * H }), false); // calibrated during this block
  assert.equal(shouldAsk({ ...est, fiveHour: null }, cal), false);
  // The logs explain 10 %; the app shows 30 % and resets an hour earlier.
  const next = answerWindow(est, cal, 30, 14 * H);
  assert.deepEqual(next.window, { start: 10 * H, offsetPct: 20, resetsAt: 14 * H });
  const plan = estimatedPlan(est, next);
  assert.equal(plan.fiveHour.usedPct, 30);
  assert.equal(plan.fiveHour.resetsAt, 14 * H);
  // The next block is a different one: no offset.
  assert.equal(estimatedPlan({ ...est, fiveHour: { start: 16 * H, resetsAt: 21 * H, cost: 3.6 } }, next).fiveHour.usedPct, 10);
});

test("a reset time typed as HH:MM is the next one within 5 hours", () => {
  const now = new Date(2026, 10, 1, 20, 30).getTime();
  assert.equal(resetFromTime("22:00", now), new Date(2026, 10, 1, 22, 0).getTime());
  assert.equal(resetFromTime("00:15", now), new Date(2026, 10, 2, 0, 15).getTime());
  assert.equal(resetFromTime("08:00", now), undefined);
  assert.equal(resetFromTime("", now), undefined);
});

test("fork.json: every string in every language, never over another table's", () => {
  const read = (f) => JSON.parse(readFileSync(new URL(`../src/i18n/${f}`, import.meta.url), "utf8")).strings;
  const [fork, extra, mac] = [read("fork.json"), read("extra.json"), read("strings.json")];
  const langs = ["zh-Hans", "hi", "es", "ar", "fr", "bn", "pt-BR", "ru", "id", "de", "tr", "ko", "ja"];
  for (const [key, entry] of Object.entries(fork)) {
    assert.ok(!(key in extra) && !(key in mac), key);
    for (const lang of langs) assert.ok(entry[lang], `${key}: ${lang}`);
  }
});
