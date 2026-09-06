"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
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

  it("keeps a subtask add form visible for every parent task", () => {
    const renderer = read("src/study-dashboard-renderer.js");
    assert.match(renderer, /function appendSubtasks\(card, task\)/);
    assert.doesNotMatch(renderer, /const subtasks = Array\.isArray\(task\.subtasks\) \? task\.subtasks : \[\];\n  if \(!subtasks\.length\) return;/);
    assert.match(renderer, /form\.className = "subtask-form"/);
    assert.match(renderer, /call\("addSubtask", task\.id/);
  });

  it("exposes calendar, reports, schedule editing, and poster save actions", () => {
    const html = read("src/study-dashboard.html");
    const renderer = read("src/study-dashboard-renderer.js");
    const preload = read("src/preload-study-dashboard.js");
    for (const id of ["studyTabs", "calendarGrid", "calendarPanel", "reportStats", "reportBreakdown", "posterPreview"]) {
      assert.match(html, new RegExp(`id="${id}"`));
    }
    assert.match(renderer, /moveCalendar/);
    assert.match(renderer, /moveReport/);
    assert.match(renderer, /saveReportPoster/);
    assert.match(preload, /addSchedule/);
    assert.match(preload, /setDailyGoal/);
  });

  it("loads every Study browser script without a global lexical collision", () => {
    const scripts = ["src/study-calendar.js", "src/report-poster-renderer.js", "src/study-dashboard-renderer.js"]
      .map((file) => read(file)).join("\n");
    assert.doesNotThrow(() => new vm.Script(scripts), "Study scripts must be valid when loaded as classic scripts");
    assert.match(read("src/preload-study-dashboard.js"), /study:get-i18n/);
    assert.match(read("src/study-ipc.js"), /study:get-i18n/);
  });

  it("keeps v5 poster, points, matrix, and focus-mode features in Study only", () => {
    const html = read("src/study-dashboard.html");
    const renderer = read("src/study-dashboard-renderer.js");
    const ipc = read("src/study-ipc.js");
    const preload = read("src/preload-study-dashboard.js");
    assert.match(html, /quadrant-grid/);
    assert.match(html, /pointsLevelFill/);
    assert.match(html, /poster-lightbox/);
    assert.match(html, /body\.focus-mode .*#resetButton/);
    assert.match(renderer, /function renderQuadrantMatrix/);
    assert.match(renderer, /getPosterActivePet/);
    assert.match(renderer, /studyPosterCaption/);
    assert.match(ipc, /study:get-poster-active-pet/);
    assert.match(preload, /getPosterFont/);
    const poster = read("src/report-poster-renderer.js");
    assert.match(poster, /canvas\.width = W/);
    assert.match(poster, /canvas\.height = H/);
  });
});
