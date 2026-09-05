"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Preload for the character select window (mirrors preload-dashboard.js:
// contextIsolation on, nodeIntegration off, invoke/send only).
contextBridge.exposeInMainWorld("characterAPI", {
  // Returns { ok, payload: { active, config, skin, skins, strings } }
  listThemes: () => ipcRenderer.invoke("character:list-themes"),
  // Persist the user's choices; main process then hot-pushes the skin payload
  // to the pet window. Returns { ok, config }.
  save: (patch) => ipcRenderer.invoke("character:save", patch),
  cancel: () => ipcRenderer.send("character:cancel"),
});
