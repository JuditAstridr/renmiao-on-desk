"use strict";

const { BrowserWindow, nativeTheme } = require("electron");
const path = require("path");
const { clampTextScale, scaleWidth, scaleHeight, applyZoomToWindow } = require("./text-scale");

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 820;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 560;
const PET_PANEL_GAP = 24;

function usableBounds(value) {
  return !!value
    && Number.isFinite(value.x) && Number.isFinite(value.y)
    && Number.isFinite(value.width) && Number.isFinite(value.height)
    && value.width > 0 && value.height > 0;
}

function clampToWorkArea(bounds, workArea) {
  const area = usableBounds(workArea)
    ? workArea
    : { x: 0, y: 0, width: 1280, height: 800 };
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    x: Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(bounds.y, area.y + area.height - height))),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = function createStudyWindowRuntime(ctx = {}) {
  let studyWindow = null;

  function shouldFollowPet(override) {
    if (typeof override === "boolean") return override;
    try {
      return typeof ctx.shouldFollowPet === "function" && ctx.shouldFollowPet() === true;
    } catch {
      return false;
    }
  }

  function getScale() {
    try {
      return clampTextScale(typeof ctx.getTextScale === "function" ? ctx.getTextScale() : 1);
    } catch {
      return 1;
    }
  }

  function initialBounds() {
    const scale = getScale();
    const width = scaleWidth(DEFAULT_WIDTH, scale);
    const height = scaleHeight(DEFAULT_HEIGHT, scale);
    const minWidth = scaleWidth(MIN_WIDTH, scale);
    const minHeight = scaleHeight(MIN_HEIGHT, scale);
    let pet = null;
    try { pet = typeof ctx.getPetWindowBounds === "function" ? ctx.getPetWindowBounds() : null; } catch {}
    const cx = pet && Number.isFinite(pet.x) ? pet.x + pet.width / 2 : 640;
    const cy = pet && Number.isFinite(pet.y) ? pet.y + pet.height / 2 : 400;
    let workArea = null;
    try { workArea = typeof ctx.getNearestWorkArea === "function" ? ctx.getNearestWorkArea(cx, cy) : null; } catch {}
    const area = usableBounds(workArea) ? workArea : { x: 0, y: 0, width: 1280, height: 800 };
    const centered = {
      bounds: clampToWorkArea({
        x: area.x + (area.width - width) / 2,
        y: area.y + (area.height - height) / 2,
        width: Math.max(minWidth, width),
        height: Math.max(minHeight, height),
      }, area),
      minWidth,
      minHeight,
    };
    if (!shouldFollowPet() || !usableBounds(pet)) return centered;
    return {
      ...centered,
      bounds: anchorBoundsNearPet(centered.bounds, pet, area),
    };
  }

  function anchorBoundsNearPet(bounds, pet, workArea) {
    if (!usableBounds(bounds) || !usableBounds(pet)) return bounds;
    const area = usableBounds(workArea) ? workArea : { x: 0, y: 0, width: 1280, height: 800 };
    const centeredY = pet.y + (pet.height - bounds.height) / 2;
    const right = { ...bounds, x: pet.x + pet.width + PET_PANEL_GAP, y: centeredY };
    const left = { ...bounds, x: pet.x - bounds.width - PET_PANEL_GAP, y: centeredY };
    const fitsHorizontally = (candidate) => candidate.x >= area.x
      && candidate.x + candidate.width <= area.x + area.width;
    return clampToWorkArea(fitsHorizontally(right) ? right : left, area);
  }

  function repositionNearPet(options = {}) {
    if (!shouldFollowPet(options.follow) || !studyWindow || studyWindow.isDestroyed()) return false;
    if (typeof studyWindow.isMaximized === "function" && studyWindow.isMaximized()) return false;
    if (typeof studyWindow.isFullScreen === "function" && studyWindow.isFullScreen()) return false;
    let pet = null;
    let current = null;
    try {
      pet = typeof ctx.getPetWindowBounds === "function" ? ctx.getPetWindowBounds() : null;
      current = typeof studyWindow.getBounds === "function" ? studyWindow.getBounds() : null;
    } catch {
      return false;
    }
    if (!usableBounds(pet) || !usableBounds(current)) return false;
    let workArea = null;
    try {
      workArea = typeof ctx.getNearestWorkArea === "function"
        ? ctx.getNearestWorkArea(pet.x + pet.width / 2, pet.y + pet.height / 2)
        : null;
    } catch {}
    const next = anchorBoundsNearPet(current, pet, workArea);
    if (next.x === current.x && next.y === current.y) return false;
    try {
      if (typeof studyWindow.setPosition === "function") studyWindow.setPosition(next.x, next.y);
      else if (typeof studyWindow.setBounds === "function") studyWindow.setBounds(next);
      return true;
    } catch {
      return false;
    }
  }

  function sendSnapshot(snapshot) {
    if (!studyWindow || studyWindow.isDestroyed()) return;
    if (!studyWindow.webContents || studyWindow.webContents.isDestroyed()) return;
    const fallback = typeof ctx.getStudySnapshot === "function" ? ctx.getStudySnapshot() : null;
    studyWindow.webContents.send("study:dashboard-snapshot", snapshot || fallback);
  }

  function sendI18n() {
    if (!studyWindow || studyWindow.isDestroyed()) return;
    if (!studyWindow.webContents || studyWindow.webContents.isDestroyed()) return;
    if (typeof ctx.t === "function" && typeof studyWindow.setTitle === "function") {
      studyWindow.setTitle(ctx.t("studyWindowTitle"));
    }
    studyWindow.webContents.send("study:lang-change", typeof ctx.getI18n === "function" ? ctx.getI18n() : {});
  }

  function createStudyWindow() {
    const metrics = initialBounds();
    const options = {
      ...metrics.bounds,
      minWidth: Math.min(metrics.minWidth, metrics.bounds.width),
      minHeight: Math.min(metrics.minHeight, metrics.bounds.height),
      show: false,
      frame: true,
      transparent: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: typeof ctx.t === "function" ? ctx.t("studyWindowTitle") : "Study Companion",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1f" : "#f5f5f7",
      webPreferences: {
        preload: path.join(__dirname, "preload-study-dashboard.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    };
    if (ctx.iconPath) options.icon = ctx.iconPath;
    studyWindow = new BrowserWindow(options);
    studyWindow.setMenuBarVisibility(false);
    studyWindow.loadFile(path.join(__dirname, "study-dashboard.html"));
    studyWindow.webContents.once("did-finish-load", () => {
      applyZoomToWindow(studyWindow, getScale());
      sendI18n();
      sendSnapshot();
    });
    studyWindow.once("ready-to-show", () => {
      if (!studyWindow || studyWindow.isDestroyed()) return;
      repositionNearPet();
      studyWindow.show();
      studyWindow.focus();
    });
    studyWindow.on("closed", () => { studyWindow = null; });
    return studyWindow;
  }

  function showStudyDashboard() {
    if (studyWindow && !studyWindow.isDestroyed()) {
      if (studyWindow.isMinimized()) studyWindow.restore();
      repositionNearPet();
      studyWindow.show();
      studyWindow.focus();
      sendI18n();
      sendSnapshot();
      return studyWindow;
    }
    return createStudyWindow();
  }

  function broadcastStudySnapshot(snapshot) {
    sendSnapshot(snapshot);
  }

  function applyTextScaleToWindow() {
    if (!studyWindow || studyWindow.isDestroyed()) return;
    try { applyZoomToWindow(studyWindow, getScale()); } catch {}
  }

  function close() {
    if (studyWindow && !studyWindow.isDestroyed()) studyWindow.close();
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", () => {
      if (!studyWindow || studyWindow.isDestroyed()) return;
      studyWindow.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#1c1c1f" : "#f5f5f7");
    });
  }

  return {
    showStudyDashboard,
    repositionNearPet,
    broadcastStudySnapshot,
    sendI18n,
    applyTextScaleToWindow,
    close,
    getWindow: () => studyWindow,
  };
};
