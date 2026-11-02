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
