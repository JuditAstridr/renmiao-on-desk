"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const configArg = process.argv.find((value) => value.startsWith("--hit-theme-config="));
let themeConfig = null;
try { themeConfig = configArg ? JSON.parse(configArg.slice("--hit-theme-config=".length)) : null; } catch {}

contextBridge.exposeInMainWorld("hitThemeConfig", themeConfig);
contextBridge.exposeInMainWorld("hitPlatform", {
  isMac: process.platform === "darwin",
  platform: process.platform,
});
contextBridge.exposeInMainWorld("hitAPI", {
  onThemeConfig: (callback) => ipcRenderer.on("theme-config", (_event, config) => callback(config)),
  dragLock: (locked, point) => ipcRenderer.send("renmi:drag-lock", locked === true, point),
  dragMove: (point) => ipcRenderer.send("renmi:drag-move", point),
  dragEnd: () => ipcRenderer.send("renmi:drag-end"),
  showContextMenu: () => ipcRenderer.send("renmi:show-context-menu"),
  exitMiniMode: () => ipcRenderer.send("renmi:exit-mini-mode"),
  playClickReaction: (svg, duration) => ipcRenderer.send("renmi:click-reaction", svg, duration),
  startDragReaction: (direction) => ipcRenderer.send("renmi:start-drag-reaction", direction),
  endDragReaction: () => ipcRenderer.send("renmi:end-drag-reaction"),
  onStateSync: (callback) => ipcRenderer.on("renmi:hit-state-sync", (_event, data) => callback(data)),
  onCancelReaction: (callback) => ipcRenderer.on("renmi:cancel-reaction", () => callback()),
});
