"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("Study Companion integration", () => {
  it("keeps the Study window and IPC separate from the Sessions Dashboard", () => {
    const main = read("src/main.js");
    const ipc = read("src/study-ipc.js");
    const menu = read("src/menu.js");
    assert.match(main, /createStudyWindowRuntime/);
    assert.match(main, /registerStudyIpc/);
    assert.match(main, /openStudyDashboard/);
    assert.match(main, /require\("\.\/dashboard"\)/);
    assert.match(ipc, /study:get-snapshot/);
    assert.match(ipc, /study:pomodoro-command/);
    assert.match(menu, /openStudyDashboard/);
  });

  it("wires the timer HUD without adding another input surface", () => {
    const preload = read("src/preload.js");
    const renderer = read("src/renderer.js");
    assert.match(preload, /onTimerTick/);
    assert.match(renderer, /clawd-timer-hud/);
    assert.match(renderer, /pointerEvents = "none"/);
  });
});
