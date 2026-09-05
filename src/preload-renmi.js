"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const themeArg = process.argv.find((value) => value.startsWith("--theme-config="));
let themeConfig = null;
try { themeConfig = themeArg ? JSON.parse(themeArg.slice("--theme-config=".length)) : null; } catch {}

contextBridge.exposeInMainWorld("themeConfig", themeConfig);
contextBridge.exposeInMainWorld("electronAPI", {
  isRenmiProfile: true,
  onThemeConfig: (callback) => ipcRenderer.on("theme-config", (_event, config) => callback(config)),
  onViewportOffset: (callback) => ipcRenderer.on("viewport-offset", (_event, value) => callback(Number.isFinite(value) ? value : 0)),
  onViewportOffsetX: (callback) => ipcRenderer.on("viewport-offset-x", (_event, value) => callback(Number.isFinite(value) ? value : 0)),
  onPetTintChange: (callback) => ipcRenderer.on("pet-tint-change", (_event, payload) => callback(payload)),
  onPetTintSaturationChange: (callback) => ipcRenderer.on("pet-tint-saturation-change", (_event, value) => callback(value)),
  onPetAccessoryChange: (callback) => ipcRenderer.on("pet-accessory-change", (_event, payload) => callback(payload)),
  onStateChange: (callback) => ipcRenderer.on("state-change", (_event, state, svg) => callback(state, svg)),
  onTimerTick: (callback) => ipcRenderer.on("timer-tick", (_event, payload) => callback(payload)),
  onEyeMove: (callback) => ipcRenderer.on("eye-move", (_event, dx, dy) => callback(dx, dy)),
  onRoamHeading: (callback) => ipcRenderer.on("roam-heading", (_event, headingLeft) => callback(headingLeft)),
  onWakeFromDoze: (callback) => ipcRenderer.on("wake-from-doze", () => callback()),
  onMiniModeChange: (callback) => ipcRenderer.on("mini-mode-change", (_event, enabled, edge, options) => callback(enabled, edge, options)),
  onMiniClip: (callback) => ipcRenderer.on("mini-clip", (_event, info) => callback(info)),
  onLowPowerIdleModeChange: (callback) => ipcRenderer.on("low-power-idle-mode-change", (_event, enabled) => callback(enabled)),
  onStartDragReaction: (callback) => ipcRenderer.on("start-drag-reaction", (_event, direction) => callback(direction)),
  onEndDragReaction: (callback) => ipcRenderer.on("end-drag-reaction", () => callback()),
  onPlayClickReaction: (callback) => ipcRenderer.on("play-click-reaction", (_event, svg, duration) => callback(svg, duration)),
  onPreloadSounds: (callback) => ipcRenderer.on("preload-sounds", (_event, payload) => callback(payload)),
  onPlaySound: (callback) => ipcRenderer.on("play-sound", (_event, payload) => callback(payload)),
  onInvalidateSoundCache: (callback) => ipcRenderer.on("invalidate-sound-cache", (_event, url) => callback(url)),
  onAmbientPrefsUpdate: (callback) => ipcRenderer.on("ambient-prefs-update", (_event, payload) => callback(payload)),
  onAmbientStateChange: (callback) => ipcRenderer.on("ambient-state-change", (_event, payload) => callback(payload)),
  onAmbientStateSoundTrigger: (callback) => ipcRenderer.on("ambient-state-sound-trigger", (_event, payload) => callback(payload)),
  reportSoundPlaybackError: (payload) => ipcRenderer.send("renmi:sound-playback-error", payload),
  pauseCursorPolling: () => ipcRenderer.send("renmi:pause-cursor-polling"),
  resumeFromReaction: () => ipcRenderer.send("renmi:resume-from-reaction"),
  notifyPetVisualReady: () => ipcRenderer.send("renmi:pet-visual-ready"),
  setLowPowerIdlePaused: (paused) => ipcRenderer.send("renmi:low-power-idle-paused", paused === true),
  reportSystemWakeStatus: () => {},
  reportAccessoryMirror: (mirrored) => ipcRenderer.send("renmi:accessory-mirror", mirrored === true),
});
