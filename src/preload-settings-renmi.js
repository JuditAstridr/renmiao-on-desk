"use strict";

const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, payload) { return ipcRenderer.invoke(channel, payload); }

contextBridge.exposeInMainWorld("settingsAPI", {
  getSnapshot: () => invoke("renmi:settings-get-snapshot"),
  update: (key, value) => invoke("renmi:settings-update", { key, value }),
  command: (name, payload) => invoke("renmi:settings-command", { name, payload }),
  listThemes: () => invoke("renmi:settings-list-themes"),
  getIdleVisuals: (themeId) => invoke("renmi:settings-idle-visuals", themeId),
  openStudy: () => invoke("renmi:open-study"),
  openAuth: () => invoke("renmi:open-auth"),
  logout: () => invoke("renmi:logout"),
  checkForUpdates: () => invoke("renmi:check-for-updates"),
  onChanged: (callback) => ipcRenderer.on("renmi:settings-changed", (_event, payload) => callback(payload)),
});
