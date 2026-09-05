"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, describe, it } = require("node:test");
const { createStudyRuntime, sanitizeState } = require("../src/study-runtime");

const runtimes = [];

function createRuntime(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-study-test-"));
  const dataPath = path.join(dir, "study-data.json");
  const runtime = createStudyRuntime({ dataPath, ...options });
  runtimes.push({ dir, runtime });
  return { dataPath, runtime };
}

afterEach(() => {
  while (runtimes.length) {
    const { dir, runtime } = runtimes.pop();
    runtime.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("study runtime", () => {
  it("persists task metadata, subtasks, and view preferences", () => {
    const { dataPath, runtime } = createRuntime({ now: () => 1000 });
    let snapshot = runtime.addTask({
      title: "Thesis",
      estimatedMinutes: 60,
      deadline: 123456,
      category: "school",
      quadrant: 0,
    });
    const taskId = snapshot.tasks[0].id;
    snapshot = runtime.addSubtask(taskId, { title: "Outline", estimatedMinutes: 20 });
    snapshot = runtime.addSubtask(taskId, { title: "Draft", estimatedMinutes: 40 });
    snapshot = runtime.setView({ sortBy: "deadline", groupBy: "quadrant" });

    assert.equal(snapshot.tasks[0].category, "school");
    assert.deepEqual(snapshot.tasks[0].subtasks.map((entry) => entry.estimatedMinutes), [20, 40]);
    assert.deepEqual(snapshot.view, { sortBy: "deadline", groupBy: "quadrant" });
    assert.deepEqual(sanitizeState(JSON.parse(fs.readFileSync(dataPath, "utf8"))), snapshot);
  });

  it("completes subtasks in order and then auto-completes the parent task", () => {
    const { runtime } = createRuntime({ now: () => 1000 });
    let snapshot = runtime.addTask({ title: "Project" });
    const taskId = snapshot.tasks[0].id;
    snapshot = runtime.addSubtask(taskId, { title: "First", estimatedMinutes: 20 });
    const firstId = snapshot.tasks[0].subtasks[0].id;
    snapshot = runtime.addSubtask(taskId, { title: "Second", estimatedMinutes: 10 });
    const secondId = snapshot.tasks[0].subtasks[1].id;

    snapshot = runtime.startTaskPomodoro(taskId);
    assert.equal(snapshot.pomodoro.currentSubtaskId, firstId);
    assert.equal(snapshot.pomodoro.totalSeconds, 20 * 60);
    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.pomodoro.awaitingContinue, true);
    assert.equal(snapshot.pomodoro.currentSubtaskId, secondId);

    snapshot = runtime.pomodoroCommand("continue");
    assert.equal(snapshot.pomodoro.phase, "focus");
    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.tasks[0].done, true);
    assert.deepEqual(snapshot.tasks[0].subtasks.map((entry) => entry.done), [true, true]);
    assert.equal(snapshot.pomodoro.phase, "idle");
  });

  it("splits a long subtask into focus-sized chunks when enabled", () => {
    const { runtime } = createRuntime({ now: () => 1000 });
    let snapshot = runtime.addTask({ title: "Reading" });
    const taskId = snapshot.tasks[0].id;
    snapshot = runtime.addSubtask(taskId, { title: "Long chapter", estimatedMinutes: 60 });
    runtime.setFocusMinutes(25);
    runtime.setSplitLongSubtasks(true);

    snapshot = runtime.startTaskPomodoro(taskId);
    assert.equal(snapshot.pomodoro.totalSeconds, 25 * 60);
    assert.equal(snapshot.pomodoro.currentSubtaskRemainingSeconds, 60 * 60);

    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.pomodoro.phase, "shortBreak");
    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.pomodoro.phase, "focus");
    assert.equal(snapshot.pomodoro.totalSeconds, 25 * 60);
    snapshot = runtime.pomodoroCommand("skip");
    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.pomodoro.totalSeconds, 10 * 60);
    snapshot = runtime.pomodoroCommand("skip");

    assert.equal(snapshot.tasks[0].done, true);
    assert.equal(snapshot.tasks[0].subtasks[0].done, true);
  });

  it("supports count-up mode and advances its elapsed time", () => {
    let clock = 1000;
    const ticks = [];
    const { runtime } = createRuntime({
      now: () => clock,
      setInterval: (callback) => { ticks.push(callback); return callback; },
      clearInterval: () => {},
    });
    runtime.setPomodoroMode("countup");
    let snapshot = runtime.pomodoroCommand("start");
    clock += 7 * 1000;
    ticks[0]();
    snapshot = runtime.getSnapshot();

    assert.equal(snapshot.pomodoro.mode, "countup");
    assert.equal(snapshot.pomodoro.elapsedSeconds, 7);
    assert.equal(snapshot.pomodoro.totalSeconds, 0);
    runtime.pomodoroCommand("reset");
    assert.equal(runtime.getSnapshot().pomodoro.elapsedSeconds, 0);
  });

  it("does not mark a task without subtasks complete until its estimate is consumed", () => {
    const { runtime } = createRuntime({ now: () => 1000 });
    let snapshot = runtime.addTask({ title: "Long task", estimatedMinutes: 50 });
    const taskId = snapshot.tasks[0].id;
    runtime.setFocusMinutes(25);
    snapshot = runtime.startTaskPomodoro(taskId);
    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.tasks[0].done, false);
    assert.equal(snapshot.pomodoro.phase, "shortBreak");
    snapshot = runtime.pomodoroCommand("skip");
    snapshot = runtime.pomodoroCommand("skip");
    assert.equal(snapshot.tasks[0].done, true);
  });

  it("converts actual focused minutes into points instead of rewarding skipped sessions", () => {
    let clock = 1000;
    const ticks = [];
    const { runtime } = createRuntime({
      now: () => clock,
      setInterval: (callback) => { ticks.push(callback); return callback; },
      clearInterval: () => {},
    });
    let snapshot = runtime.addTask({ title: "Practice", estimatedMinutes: 30 });
    snapshot = runtime.startTaskPomodoro(snapshot.tasks[0].id);
    snapshot = runtime.pomodoroCommand("skip");

    assert.equal(snapshot.points.total, 0);
    assert.equal(snapshot.points.today, 0);
    snapshot = runtime.pomodoroCommand("skip");
    clock += 2 * 60 * 1000;
    ticks[0]();
    snapshot = runtime.getSnapshot();
    assert.equal(snapshot.points.total, 2);
    assert.equal(snapshot.points.today, 2);
    assert.equal(snapshot.points.streak, 1);
    assert.equal(snapshot.tasks[0].done, false);
  });
});
