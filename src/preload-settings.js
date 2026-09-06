"use strict";

// ── Settings panel preload ──
//
// Surface: window.settingsAPI
//
//   discordDefaultAppIdPresent          boolean — a default Discord App ID is
//                                       hardcoded (maintainer-shipped)
//   getSnapshot()                       Promise<snapshot>
//   getPetTintOptions()                 Promise<Array<{id, labelKey}>>
//   getPetAccessoryOptions()            Promise<Array<{id, labelKey}>>
//   update(key, value)                  Promise<{ status, message? }>
//   command(action, payload)            Promise<{ status, message? }>
//   listAgents()                        Promise<Array<{id, name, ...}>>
//   onChanged(cb)                       cb({ changes, snapshot? }) — fires for
//                                       every settings-changed broadcast
//   onAgentActivity(cb)                 cb({ agentId, timestamp, eventType }) —
//                                       accepted custom /state activity only
//   onAnimationPreviewPosterReady(cb)   cb({ themeId, filename, previewImageUrl,
//                                       previewPosterCacheKey }) — incremental
//                                       animation override preview poster
//
// All writes go through the main-process "settings:update" handler, which
// routes through the controller. The renderer never owns state — it always
// re-renders from the snapshot delivered via onChanged broadcasts (or the
// initial getSnapshot() call). This is the unidirectional flow contract from
// plan-settings-panel.md §4.2.

const { contextBridge, ipcRenderer } = require("electron");

// A sandboxed preload (Electron's default since 20) may only require "electron"
// plus a few Node builtins — never an app module. The "is a default Discord App
// ID baked in?" flag is therefore injected by value from main, via
// webPreferences.additionalArguments, and read off process.argv here.
const DISCORD_DEFAULT_APP_ID_FLAG = "--discord-default-app-id-present=";
const discordDefaultAppIdArg = process.argv.find((a) => a.startsWith(DISCORD_DEFAULT_APP_ID_FLAG));
const discordDefaultAppIdPresent =
  !!discordDefaultAppIdArg && discordDefaultAppIdArg.slice(DISCORD_DEFAULT_APP_ID_FLAG.length) === "1";
const isRenmiProfile = process.argv.includes("--renmi-profile=1");

const listeners = new Set();
const shortcutFailureListeners = new Set();
const shortcutRecordKeyListeners = new Set();
const textScaleContextListeners = new Set();
const agentActivityListeners = new Set();
const updateCheckStatusListeners = new Set();
const petSkinOptionsListeners = new Set();
const petAccessoryOptionsListeners = new Set();
const studySnapshotListeners = new Set();
const studyLangListeners = new Set();
ipcRenderer.on("settings-changed", (_event, payload) => {
  for (const cb of listeners) {
    try { cb(payload); } catch (err) { console.warn("settings onChanged listener threw:", err); }
  }
});
ipcRenderer.on("shortcut-failures-changed", (_event, payload) => {
  for (const cb of shortcutFailureListeners) {
    try { cb(payload); } catch (err) { console.warn("shortcut failure listener threw:", err); }
  }
});
ipcRenderer.on("shortcut-record-key", (_event, payload) => {
  for (const cb of shortcutRecordKeyListeners) {
    try { cb(payload); } catch (err) { console.warn("shortcut record listener threw:", err); }
  }
});
// Fired by the settings-window runtime whenever the window's effective text
// scale was re-resolved (display move, topology change, commit) — the
// committed percent lives main-side, so the slider must re-pull it.
ipcRenderer.on("settings:text-scale-context-changed", () => {
  for (const cb of textScaleContextListeners) {
    try { cb(); } catch (err) { console.warn("text scale context listener threw:", err); }
  }
});
ipcRenderer.on("settings:agent-activity", (_event, payload) => {
  for (const cb of agentActivityListeners) {
    try { cb(payload); } catch (err) { console.warn("agent activity listener threw:", err); }
  }
});
ipcRenderer.on("settings:update-check-status", (_event, payload) => {
  for (const cb of updateCheckStatusListeners) {
    try { cb(payload); } catch (err) { console.warn("update check status listener threw:", err); }
  }
});
ipcRenderer.on("settings:pet-accessory-options-changed", (_event, payload) => {
  for (const cb of petAccessoryOptionsListeners) {
    try { cb(payload); } catch (err) { console.warn("pet accessory options listener threw:", err); }
  }
});
ipcRenderer.on("settings:pet-skin-options-changed", (_event, payload) => {
  for (const cb of petSkinOptionsListeners) {
    try { cb(payload); } catch (err) { console.warn("pet skin options listener threw:", err); }
  }
});
ipcRenderer.on("study:dashboard-snapshot", (_event, snapshot) => {
  for (const cb of studySnapshotListeners) {
    try { cb(snapshot); } catch (err) { console.warn("study snapshot listener threw:", err); }
  }
});
ipcRenderer.on("study:lang-change", (_event, payload) => {
  for (const cb of studyLangListeners) {
    try { cb(payload); } catch (err) { console.warn("study language listener threw:", err); }
  }
});

contextBridge.exposeInMainWorld("settingsAPI", {
  isRenmiProfile,
  // Capability flag: true when a default Discord App ID is hardcoded (maintainer-
  // shipped), so the presence enable switch can be ready without a user-saved App ID.
  discordDefaultAppIdPresent,
  getSnapshot: () => ipcRenderer.invoke("settings:get-snapshot"),
  getQuotaSourceCount: () => ipcRenderer.invoke("settings:get-quota-source-count"),
  getQuotaRingProviders: () => ipcRenderer.invoke("settings:get-quota-ring-providers"),
  getKimiQuotaStatus: () => ipcRenderer.invoke("settings:kimi-quota-status"),
  connectKimiQuota: (apiKey) => ipcRenderer.invoke("settings:kimi-quota-connect", { apiKey }),
  refreshKimiQuota: () => ipcRenderer.invoke("settings:kimi-quota-refresh"),
  reconnectKimiQuota: () => ipcRenderer.invoke("settings:kimi-quota-reconnect"),
  disconnectKimiQuota: () => ipcRenderer.invoke("settings:kimi-quota-disconnect"),
  forgetKimiQuotaCredential: () => ipcRenderer.invoke("settings:kimi-quota-forget"),
  getPetTintOptions: () => ipcRenderer.invoke("settings:get-pet-tint-options"),
  getPetSkinOptions: () => ipcRenderer.invoke("settings:get-pet-skin-options"),
  getPetAccessoryOptions: () => ipcRenderer.invoke("settings:get-pet-accessory-options"),
  onPetSkinOptionsChanged: (cb) => {
    if (typeof cb !== "function") return () => {};
    petSkinOptionsListeners.add(cb);
    return () => petSkinOptionsListeners.delete(cb);
  },
  onPetAccessoryOptionsChanged: (cb) => {
    if (typeof cb !== "function") return () => {};
    petAccessoryOptionsListeners.add(cb);
    return () => petAccessoryOptionsListeners.delete(cb);
  },
  getRoamFence: () => ipcRenderer.invoke("settings:get-roam-fence"),
  selectRoamFence: () => ipcRenderer.invoke("settings:select-roam-fence"),
  clearRoamFence: () => ipcRenderer.invoke("settings:clear-roam-fence"),
  getShortcutFailures: () => ipcRenderer.invoke("settings:getShortcutFailures"),
  getAnimationOverridesData: () => ipcRenderer.invoke("settings:get-animation-overrides-data"),
  openThemeAssetsDir: () => ipcRenderer.invoke("settings:open-theme-assets-dir"),
  previewAnimationOverride: (payload) => ipcRenderer.invoke("settings:preview-animation-override", payload),
  previewReaction: (payload) => ipcRenderer.invoke("settings:preview-reaction", payload),
  pickSoundFile: (payload) => ipcRenderer.invoke("settings:pick-sound-file", payload),
  previewSound: (payload) => ipcRenderer.invoke("settings:preview-sound", payload),
  openSoundOverridesDir: () => ipcRenderer.invoke("settings:open-sound-overrides-dir"),
  beginSizePreview: () => ipcRenderer.invoke("settings:begin-size-preview"),
  previewSize: (value) => ipcRenderer.invoke("settings:preview-size", value),
  endSizePreview: (value) => ipcRenderer.invoke("settings:end-size-preview", value),
  previewTextScale: (value) => ipcRenderer.invoke("settings:preview-text-scale", value),
  endTextScalePreview: () => ipcRenderer.invoke("settings:end-text-scale-preview"),
  getTextScaleContext: () => ipcRenderer.invoke("settings:get-text-scale-context"),
  onTextScaleContextChanged: (cb) => {
    if (typeof cb !== "function") return () => {};
    textScaleContextListeners.add(cb);
    return () => textScaleContextListeners.delete(cb);
  },
  exportAnimationOverrides: () => ipcRenderer.invoke("settings:export-animation-overrides"),
  importAnimationOverrides: () => ipcRenderer.invoke("settings:import-animation-overrides"),
  enterShortcutRecording: (actionId) => ipcRenderer.invoke("settings:enterShortcutRecording", actionId),
  exitShortcutRecording: () => ipcRenderer.invoke("settings:exitShortcutRecording"),
  update: (key, value) => ipcRenderer.invoke("settings:update", { key, value }),
  getPreviewSoundUrl: () => ipcRenderer.invoke("settings:get-preview-sound-url"),
  command: (action, payload) => ipcRenderer.invoke("settings:command", { action, payload }),
  openDashboard: () => ipcRenderer.send("settings:open-dashboard"),
  openStudyDashboard: () => ipcRenderer.send("settings:open-study-dashboard"),
  listAgents: () => ipcRenderer.invoke("settings:list-agents"),
  pickAgentDiscoveryPath: (kind) => ipcRenderer.invoke("settings:pick-agent-discovery-path", { kind }),
  detectAgentInstallations: (opts) => ipcRenderer.invoke("settings:detect-agent-installations", opts),
  getAboutInfo: () => ipcRenderer.invoke("settings:get-about-info"),
  checkForUpdates: () => ipcRenderer.invoke("settings:check-for-updates"),
  clearUpdateError: () => ipcRenderer.invoke("settings:clear-update-error"),
  copyUpdateError: (copyText) => ipcRenderer.invoke("settings:copy-update-error", copyText),
  showTutorial: () => ipcRenderer.invoke("settings:show-tutorial"),
  openExternal: (url) => ipcRenderer.invoke("settings:open-external", url),
  listThemes: () => ipcRenderer.invoke("settings:list-themes"),
  openUserThemesDir: () => ipcRenderer.invoke("settings:open-user-themes-dir"),
  importUserThemeZip: () => ipcRenderer.invoke("settings:import-user-theme-zip"),
  refreshCodexPets: () => ipcRenderer.invoke("settings:refresh-codex-pets"),
  openCodexPetsDir: () => ipcRenderer.invoke("settings:open-codex-pets-dir"),
  importCodexPetZip: () => ipcRenderer.invoke("settings:import-codex-pet-zip"),
  removeCodexPet: (themeId) => ipcRenderer.invoke("settings:remove-codex-pet", themeId),
  confirmRemoveTheme: (themeId) =>
    ipcRenderer.invoke("settings:confirm-remove-theme", themeId),
  onChanged: (cb) => {
    if (typeof cb === "function") listeners.add(cb);
  },
  onAgentActivity: (cb) => {
    if (typeof cb !== "function") return () => {};
    agentActivityListeners.add(cb);
    return () => agentActivityListeners.delete(cb);
  },
  onAnimationPreviewPosterReady: (cb) => {
    if (typeof cb !== "function") return () => {};
    const listener = (_event, payload) => {
      try { cb(payload); } catch (err) { console.warn("animation preview poster listener threw:", err); }
    };
    ipcRenderer.on("settings:animation-preview-poster-ready", listener);
    return () => ipcRenderer.removeListener("settings:animation-preview-poster-ready", listener);
  },
  onShortcutFailuresChanged: (cb) => {
    if (typeof cb !== "function") return () => {};
    shortcutFailureListeners.add(cb);
    return () => shortcutFailureListeners.delete(cb);
  },
  onShortcutRecordKey: (cb) => {
    if (typeof cb !== "function") return () => {};
    shortcutRecordKeyListeners.add(cb);
    return () => shortcutRecordKeyListeners.delete(cb);
  },
  onUpdateCheckStatus: (cb) => {
    if (typeof cb !== "function") return () => {};
    updateCheckStatusListeners.add(cb);
    return () => updateCheckStatusListeners.delete(cb);
  },
});

contextBridge.exposeInMainWorld("doctor", {
  runChecks: () => ipcRenderer.invoke("doctor:run-checks"),
  getReport: () => ipcRenderer.invoke("doctor:get-report"),
  testConnection: (durationMs) => ipcRenderer.invoke("doctor:test-connection", { durationMs }),
  openClawdLog: () => ipcRenderer.invoke("doctor:open-clawd-log"),
  codexHookHealth: () => ipcRenderer.invoke("doctor:codex-hook-health"),
});

// The Settings window can host the Study Companion in an iframe. Expose the
// same narrow bridge used by preload-study-dashboard so the embedded page can
// reuse the existing Study IPC contract without moving its business logic into
// Settings. The embedded page accesses this object through window.parent when
// its own preload is not applied to subframes.
contextBridge.exposeInMainWorld("studyAPI", {
  getSnapshot: () => ipcRenderer.invoke("study:get-snapshot"),
  getReport: (spec) => ipcRenderer.invoke("study:get-report", spec),
  getPosterActivePet: () => ipcRenderer.invoke("study:get-poster-active-pet"),
  getPosterAssets: (ids) => ipcRenderer.invoke("study:get-poster-assets", ids),
  getPosterFont: () => ipcRenderer.invoke("study:get-poster-font"),
  getI18n: () => ipcRenderer.invoke("study:get-i18n"),
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
  addDailyGoal: (payload) => ipcRenderer.invoke("study:add-daily-goal", payload),
  removeDailyGoal: (id) => ipcRenderer.invoke("study:remove-daily-goal", id),
  updateDailyGoal: (id, patch) => ipcRenderer.invoke("study:update-daily-goal", { id, patch }),
  startDailyGoal: (goal) => ipcRenderer.invoke("study:start-daily-goal", goal),
  saveReportPoster: (payload) => ipcRenderer.invoke("study:save-report-poster", payload),
  pomodoroCommand: (command) => ipcRenderer.invoke("study:pomodoro-command", command),
  onSnapshot: (callback) => {
    if (typeof callback !== "function") return () => {};
    studySnapshotListeners.add(callback);
    return () => studySnapshotListeners.delete(callback);
  },
  onLangChange: (callback) => {
    if (typeof callback !== "function") return () => {};
    studyLangListeners.add(callback);
    return () => studyLangListeners.delete(callback);
  },
});
