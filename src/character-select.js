"use strict";

// Character select window (main-process side).
//
// A small framed window that lists available skins (discovered data-driven
// by character-loader.js), previews them through the SAME shared renderer
// modules as the pet window (skin-stage.js / skin-fill.js), and saves the
// user's choices via character-config.js. On save it hot-pushes the resolved
// skin payload to the pet window over the "character-config" channel, so the
// pet updates without a restart.
//
// The window is opened on demand from the tray/context menu, and is also
// shown once after first authentication when no choice has been saved yet.

const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

const WINDOW_WIDTH = 780;
const WINDOW_HEIGHT = 620;
const LIGHT_BACKGROUND = "#f5f5f7";

// English fallbacks for languages that don't ship the character keys yet;
// ctx.t returns the key itself when a translation is missing.
const STRING_KEYS = [
  ["characterSelectTitle", "Choose your companion"],
  ["characterConfirm", "Confirm"],
  ["characterCancel", "Cancel"],
  ["characterPreview", "Preview"],
  ["characterColor", "Body color"],
  ["characterSize", "Size"],
  ["characterPatterns", "Patterns"],
  ["characterAccessories", "Accessories"],
  ["characterStateIdle", "Idle"],
  ["characterStateStudying", "Studying"],
  ["characterStateReward", "Celebrating"],
  ["characterStateSleeping", "Sleeping"],
  ["characterNoSkins", "No companions found yet."],
];

let ipcRegistered = false;

module.exports = function initCharacterSelect(ctx) {
  let selectWindow = null;

  function t(key, fallback) {
    if (typeof ctx.t !== "function") return fallback;
    const value = ctx.t(key);
    return value === key ? fallback : value;
  }

  function getStrings() {
    const strings = {};
    for (const [key, fallback] of STRING_KEYS) {
      strings[key] = t(key, fallback);
    }
    return strings;
  }

  function getPayload() {
    const payload = ctx.resolveCharacterPayload();
    return { ...payload, strings: getStrings() };
  }

  function broadcastSkinConfig() {
    if (typeof ctx.sendToRenderer !== "function") return;
    try {
      ctx.sendToRenderer("character-config", ctx.resolveCharacterPayload());
    } catch (err) {
      console.warn("[character-select] broadcast failed:", err && err.message);
    }
  }

  function registerIpc() {
    if (ipcRegistered) return;
    ipcRegistered = true;

    ipcMain.handle("character:list-themes", () => {
      try {
        return { ok: true, payload: getPayload() };
      } catch (err) {
        return { ok: false, message: err && err.message };
      }
    });

    ipcMain.handle("character:save", (_event, patch) => {
      try {
        const config = ctx.saveCharacterConfig(patch);
        broadcastSkinConfig();
        return { ok: true, config };
      } catch (err) {
        return { ok: false, message: err && err.message };
      }
    });

    ipcMain.on("character:cancel", () => {
      if (selectWindow && !selectWindow.isDestroyed()) selectWindow.close();
    });

    // Entry point reserved for the login page / external callers.
    ipcMain.on("character:open-selector", () => {
      showSelectWindow();
    });
  }

  function createWindow() {
    const opts = {
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      minWidth: 640,
      minHeight: 520,
      show: false,
      frame: true,
      transparent: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: t("characterSelectTitle", "Choose your companion"),
      backgroundColor: LIGHT_BACKGROUND,
      webPreferences: {
        preload: path.join(__dirname, "preload-character-select.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    };
    if (ctx.iconPath) opts.icon = ctx.iconPath;

    selectWindow = new BrowserWindow(opts);
    selectWindow.setMenuBarVisibility(false);
    selectWindow.loadFile(path.join(__dirname, "character-select.html"));
    selectWindow.once("ready-to-show", () => {
      if (!selectWindow || selectWindow.isDestroyed()) return;
      selectWindow.show();
      selectWindow.focus();
    });
    selectWindow.on("closed", () => {
      selectWindow = null;
    });
    return selectWindow;
  }

  function showSelectWindow() {
    if (selectWindow && !selectWindow.isDestroyed()) {
      if (selectWindow.isMinimized()) selectWindow.restore();
      selectWindow.show();
      selectWindow.focus();
      return selectWindow;
    }
    return createWindow();
  }

  registerIpc();

  return {
    showSelectWindow,
    getWindow: () => selectWindow,
  };
};
