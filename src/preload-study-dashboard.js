"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const snapshotListeners = new Set();
const langListeners = new Set();

ipcRenderer.on("study:dashboard-snapshot", (_event, snapshot) => {
  for (const listener of snapshotListeners) {
    try { listener(snapshot); } catch (error) { console.warn("study snapshot listener threw:", error); }
  }
});

ipcRenderer.on("study:lang-change", (_event, payload) => {
  for (const listener of langListeners) {
    try { listener(payload); } catch (error) { console.warn("study language listener threw:", error); }
  }
});

contextBridge.exposeInMainWorld("studyAPI", {
  getSnapshot: () => ipcRenderer.invoke("study:get-snapshot"),
  getReport: (spec) => ipcRenderer.invoke("study:get-report", spec),
  getPosterActivePet: () => ipcRenderer.invoke("study:get-poster-active-pet"),
  getPosterAssets: (ids) => ipcRenderer.invoke("study:get-poster-assets", ids),
  getPosterFont: () => ipcRenderer.invoke("study:get-poster-font"),
  getI18n: () => ipcRenderer.invoke("dashboard:get-i18n"),
  addTask: (payload) => ipcRenderer.invoke("study:add-task", payload),
  updateTask: (id, patch) => ipcRenderer.invoke("study:update-task", { id, patch }),
  toggleTask: (id) => ipcRenderer.invoke("study:toggle-task", id),
  removeTask: (id) => ipcRenderer.invoke("study:remove-task", id),
  addSubtask: (id, subtask) => ipcRenderer.invoke("study:add-subtask", { id, subtask }),
  updateSubtask: (id, subtaskId, patch) => ipcRenderer.invoke("study:update-subtask", { id, subtaskId, patch }),
  toggleSubtask: (id, subtaskId) => ipcRenderer.invoke("study:toggle-subtask", { id, subtaskId }),
  removeSubtask: (id, subtaskId) => ipcRenderer.invoke("study:remove-subtask", { id, subtaskId }),
  startTaskPomodoro: (id) => ipcRenderer.invoke("study:start-task-pomodoro", id),
  setFocusMinutes: (minutes) => ipcRenderer.invoke("study:set-focus-minutes", minutes),
  setShortBreakMinutes: (minutes) => ipcRenderer.invoke("study:set-short-break-minutes", minutes),
  setSplitLongSubtasks: (value) => ipcRenderer.invoke("study:set-split-long-subtasks", value),
  setPauseBetweenCycles: (value) => ipcRenderer.invoke("study:set-pause-between-cycles", value),
  setPomodoroMode: (mode) => ipcRenderer.invoke("study:set-pomodoro-mode", mode),
  setView: (payload) => ipcRenderer.invoke("study:set-view", payload),
  addSchedule: (payload) => ipcRenderer.invoke("study:add-schedule", payload),
  updateSchedule: (id, patch) => ipcRenderer.invoke("study:update-schedule", { id, patch }),
  toggleSchedule: (id) => ipcRenderer.invoke("study:toggle-schedule", id),
  removeSchedule: (id) => ipcRenderer.invoke("study:remove-schedule", id),
  setDailyGoal: (payload) => ipcRenderer.invoke("study:set-daily-goal", payload),
  saveReportPoster: (payload) => ipcRenderer.invoke("study:save-report-poster", payload),
  pomodoroCommand: (command) => ipcRenderer.invoke("study:pomodoro-command", command),
  onSnapshot: (callback) => {
    if (typeof callback !== "function") return () => {};
    snapshotListeners.add(callback);
    return () => snapshotListeners.delete(callback);
  },
  onLangChange: (callback) => {
    if (typeof callback !== "function") return () => {};
    langListeners.add(callback);
    return () => langListeners.delete(callback);
  },
});
