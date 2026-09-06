"use strict";

// IPC boundary for the Study Companion page. Keeping this separate from
// session-ipc.js prevents study data from becoming part of the established
// coding-agent dashboard contract. The page may be standalone or embedded in
// the trusted Settings window.

function requiredDependency(value, name) {
  if (!value) throw new Error(`registerStudyIpc requires ${name}`);
  return value;
}

function registerStudyIpc(options = {}) {
  const ipcMain = requiredDependency(options.ipcMain, "ipcMain");
  const studyRuntime = requiredDependency(options.studyRuntime, "studyRuntime");
  const getI18n = typeof options.getI18n === "function" ? options.getI18n : () => ({});
  const broadcast = typeof options.broadcast === "function" ? options.broadcast : () => {};
  const getStudyWindow = typeof options.getStudyWindow === "function"
    ? options.getStudyWindow
    : () => null;
  const getSettingsWindow = typeof options.getSettingsWindow === "function"
    ? options.getSettingsWindow
    : () => null;
  const posterAssets = options.posterAssets && typeof options.posterAssets === "object"
    ? options.posterAssets
    : null;
  const saveReportPoster = typeof options.saveReportPoster === "function"
    ? options.saveReportPoster
    : null;
  const disposers = [];

  function isWindowSender(window, event) {
    if (!window || (typeof window.isDestroyed === "function" && window.isDestroyed())) return false;
    return !!(window.webContents && event && event.sender === window.webContents);
  }

  function allowedSender(event) {
    return isWindowSender(getStudyWindow(), event) || isWindowSender(getSettingsWindow(), event);
  }

  function handle(channel, listener) {
    const wrapped = (event, ...args) => {
      if (!allowedSender(event)) return { status: "error", message: "untrusted-study-sender" };
      return listener(event, ...args);
    };
    ipcMain.handle(channel, wrapped);
    disposers.push(() => {
      try { ipcMain.removeHandler(channel); } catch {}
    });
  }

  function mutate(method, ...args) {
    const snapshot = studyRuntime[method](...args);
    broadcast(snapshot);
    return snapshot;
  }

  handle("study:get-snapshot", () => studyRuntime.getSnapshot());
  handle("study:get-i18n", () => getI18n());
  handle("study:get-report", (_event, spec) => studyRuntime.getReport(spec));
  if (posterAssets) {
    handle("study:get-poster-active-pet", () => posterAssets.getActivePet());
    handle("study:get-poster-assets", (_event, ids) => posterAssets.getPosterAssets(ids));
    handle("study:get-poster-font", () => posterAssets.getPosterFont());
  }
  handle("study:add-task", (_event, payload) => mutate("addTask", payload));
  handle("study:update-task", (_event, payload) => mutate(
    "updateTask",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.patch : null,
  ));
  handle("study:toggle-task", (_event, id) => mutate("toggleTask", typeof id === "string" ? id : ""));
  handle("study:remove-task", (_event, id) => mutate("removeTask", typeof id === "string" ? id : ""));
  handle("study:add-subtask", (_event, payload) => mutate(
    "addSubtask",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.subtask : null,
  ));
  handle("study:update-subtask", (_event, payload) => mutate(
    "updateSubtask",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.subtaskId : "",
    payload && typeof payload === "object" ? payload.patch : null,
  ));
  handle("study:toggle-subtask", (_event, payload) => mutate(
    "toggleSubtask",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.subtaskId : "",
  ));
  handle("study:remove-subtask", (_event, payload) => mutate(
    "removeSubtask",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.subtaskId : "",
  ));
  handle("study:start-task-pomodoro", (_event, id) => mutate(
    "startTaskPomodoro",
    typeof id === "string" ? id : "",
  ));
  handle("study:set-focus-minutes", (_event, minutes) => mutate("setFocusMinutes", minutes));
  handle("study:set-short-break-minutes", (_event, minutes) => mutate("setShortBreakMinutes", minutes));
  handle("study:set-split-long-subtasks", (_event, value) => mutate("setSplitLongSubtasks", value === true));
  handle("study:set-pause-between-cycles", (_event, value) => mutate("setPauseBetweenCycles", value !== false));
  handle("study:set-pomodoro-mode", (_event, mode) => mutate(
    "setPomodoroMode",
    typeof mode === "string" ? mode : "",
  ));
  handle("study:set-view", (_event, payload) => mutate("setView", payload));
  handle("study:add-schedule", (_event, payload) => mutate("addSchedule", payload));
  handle("study:update-schedule", (_event, payload) => mutate(
    "updateSchedule",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.patch : null,
  ));
  handle("study:toggle-schedule", (_event, id) => mutate("toggleSchedule", typeof id === "string" ? id : ""));
  handle("study:remove-schedule", (_event, id) => mutate("removeSchedule", typeof id === "string" ? id : ""));
  handle("study:set-daily-goal", (_event, payload) => mutate("setDailyGoal", payload));
  handle("study:add-daily-goal", (_event, payload) => mutate("addDailyGoal", payload));
  handle("study:remove-daily-goal", (_event, id) => mutate("removeDailyGoal", typeof id === "string" ? id : ""));
  handle("study:update-daily-goal", (_event, payload) => mutate(
    "updateDailyGoal",
    payload && typeof payload === "object" ? payload.id : "",
    payload && typeof payload === "object" ? payload.patch : null,
  ));
  handle("study:start-daily-goal", (_event, payload) => mutate("startDailyGoal", payload));
  handle("study:pomodoro-command", (_event, command) => mutate(
    "pomodoroCommand",
    typeof command === "string" ? command : "",
  ));
  if (saveReportPoster) {
    handle("study:save-report-poster", (event, payload) => saveReportPoster(event, payload));
  }

  return {
    dispose() {
      while (disposers.length) disposers.pop()();
    },
  };
}

module.exports = { registerStudyIpc };
