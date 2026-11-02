// Fork: the island docked in the taskbar folds to the compact pill, never hides (src/island/fsm.ts).

import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { IslandStateMachine } from "../src/island/fsm.ts";

test("docked, the island stays a compact pill", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  const fsm = new IslandStateMachine();
  fsm.neverHides = true;
  fsm.reveal();
  mock.timers.tick(fsm.petitToHiddenDelay * 1000 + 1);
  assert.equal(fsm.state, "petit");
  fsm.forceHidden();
  assert.equal(fsm.state, "petit");
  mock.timers.reset();
});

test("open, the panel floats above the taskbar; folded, the pill sits at the bottom", async () => {
  const { dockedRect, LIFT } = await import("../src/island/dock.ts");
  const vh = (window.innerHeight = 368);
  assert.equal(dockedRect(288, 32).y, vh - 32);
  assert.equal(dockedRect(640, 176).y, vh - 176 - LIFT);
  // Mid-morph the bottom edge moves with the growth, never jumps.
  assert.equal(dockedRect(400, 52).y, vh - 52 - 20);
});

test("open, the pill and the gap under the panel still count as on the island", async () => {
  const { dockedHitRect, dockedRect } = await import("../src/island/dock.ts");
  const vh = (window.innerHeight = 368);
  const open = dockedHitRect(dockedRect(720, 320));
  assert.equal(open.y + open.h, vh); // down to the pill at the bottom edge
  const pill = dockedRect(172, 32);
  assert.deepEqual(dockedHitRect(pill), pill);
});

test("the pill's tone: all work looks alike, alerts keep their own", async () => {
  const { dockTone } = await import("../src/island/dock.ts");
  assert.equal(dockTone("thinking"), "working");
  assert.equal(dockTone("approval"), "approval");
  assert.equal(dockTone("ratelimit"), "error");
  assert.equal(dockTone("finished"), "done");
  assert.equal(dockTone("sleeping"), "idle");
});

test("in the taskbar the pill is as wide as what it shows", async () => {
  const { dockedCompactW } = await import("../src/island/dock.ts");
  assert.equal(dockedCompactW(false, false), 80); // Mochi alone: the mini pill's width
  assert.equal(dockedCompactW(false, true), 116);
  assert.equal(dockedCompactW(true, false), 134);
  assert.equal(dockedCompactW(true, true), 172);
});

test("the agents panel's steps: the last few, done, the last one current while under way", async () => {
  const { stepMarks } = await import("../src/island/dock.ts");
  const steps = ["a", "b", "c", "d"];
  assert.deepEqual(stepMarks(steps, "working", 3), [
    { text: "b", now: false }, { text: "c", now: false }, { text: "d", now: true },
  ]);
  assert.equal(stepMarks(steps, "approval", 5).at(-1).now, true);
  assert.ok(stepMarks(steps, "finished", 5).every((m) => !m.now));
  assert.ok(stepMarks(steps, "idle", 5).every((m) => !m.now));
  assert.deepEqual(stepMarks([], "working", 5), []);
});

test("a new prompt starts the turn's clock; only a pill not already in front is brought forward", async () => {
  const { dockHook, turnStartedAt } = await import("../src/island/dock.ts");
  assert.equal(turnStartedAt("agent_x"), undefined);
  dockHook("UserPromptSubmit", "agent_x", "compact", "agent_x", false, true);
  assert.ok(Math.abs(turnStartedAt("agent_x") - Date.now()) < 1000);
  assert.equal(dockHook("UserPromptSubmit", "agent_x", "compact", "agent_x", false, true), false); // already in front
  assert.equal(dockHook("UserPromptSubmit", "agent_y", "compact", "agent_x", false, true), true);
  // A waiting permission keeps the front: its card names the focused pill.
  assert.equal(dockHook("UserPromptSubmit", "agent_y", "compact", "agent_x", true, true), false);
  assert.equal(dockHook("UserPromptSubmit", "agent_y", "compact", "agent_x", false, false), false); // not docked
});

test("docked, a pill starting a turn comes to the front, never under the open panel", async () => {
  const { followsActivity } = await import("../src/island/dock.ts");
  assert.equal(followsActivity("UserPromptSubmit", "compact", true), true);
  assert.equal(followsActivity("SessionStart", "hidden", true), true);
  assert.equal(followsActivity("PreToolUse", "compact", true), false);
  assert.equal(followsActivity("UserPromptSubmit", "expanded", true), false);
  assert.equal(followsActivity("UserPromptSubmit", "compact", false), false);
});
