"use strict";

// IPC boundary for the independent Study Companion window.  Keeping this
// separate from session-ipc.js prevents study data from becoming part of the
// established coding-agent dashboard contract.

function requiredDependency(value, name) {
  if (!value) throw new Error(`registerStudyIpc requires ${name}`);
  return value;
}

function registerStudyIpc(options = {}) {
  const ipcMain = requiredDependency(options.ipcMain, "ipcMain");
  const studyRuntime = requiredDependency(options.studyRuntime, "studyRuntime");
  const broadcast = typeof options.broadcast === "function" ? options.broadcast : () => {};
  const getStudyWindow = typeof options.getStudyWindow === "function"
    ? options.getStudyWindow
    : () => null;
  const disposers = [];

  function allowedSender(event) {
    const studyWindow = getStudyWindow();
    return !!(
      studyWindow
      && !studyWindow.isDestroyed()
      && studyWindow.webContents
      && event
      && event.sender === studyWindow.webContents
    );
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
  handle("study:pomodoro-command", (_event, command) => mutate(
    "pomodoroCommand",
    typeof command === "string" ? command : "",
  ));

  return {
    dispose() {
      while (disposers.length) disposers.pop()();
    },
  };
}

module.exports = { registerStudyIpc };
