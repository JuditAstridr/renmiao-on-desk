"use strict";

// Renmi composition root.
//
// This entry point is intentionally separate from the historical composition
// root. The product process contains only the desktop pet, themes, Ambient,
// Study, authentication, and update services.

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  screen,
  ipcMain,
  globalShortcut,
  nativeTheme,
  nativeImage,
  safeStorage,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const { createSettingsController } = require("./settings-controller");
const renmiPrefs = require("./renmi-prefs");
const renmiActions = require("./renmi-settings-actions");
const themeLoader = require("./theme-loader");
const createThemeRuntime = require("./theme-runtime");
const createThemeFadeSequencer = require("./theme-fade-sequencer");
const createPetWindowRuntime = require("./pet-window-runtime");
const initTick = require("./tick");
const initMini = require("./mini");
const initRoam = require("./roam");
const { createPetState } = require("./pet-state");
const { createAmbientRuntime } = require("./ambient-runtime");
const createSettingsWindowRuntime = require("./settings-window");
const { createStudyRuntime } = require("./study-runtime");
const createStudyWindowRuntime = require("./study-window");
const { registerStudyIpc } = require("./study-ipc");
const { createAuthRuntime } = require("./auth-runtime");
const {
  defaultProfile,
  sanitizeProfile,
  hasMeaningfulStudyState,
} = require("./account-profile");
const { i18n, SUPPORTED_LANGS } = require("./i18n");
const { findNearestWorkArea, SYNTHETIC_WORK_AREA } = require("./work-area");
const {
  getLaunchPixelSize,
  getLaunchSizingWorkArea,
  getProportionalPixelSize,
} = require("./size-utils");
const { keepOutOfTaskbar } = require("./taskbar");
const {
  getPetTintIdForTheme,
  resolvePetTintPayload,
  getPetTintSaturationForTheme,
  buildPetAccessoryPayload,
  resolvePetAccessoryPayload,
} = require("./pet-customization-catalog");
const { getEffectivePetAccessoryIdForTheme } = require("./holiday-accessory");
const { resolveIdleVisualChoice } = require("./idle-visual");

const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isWin = process.platform === "win32";
const SIZES = Object.freeze({
  S: { width: 200, height: 200 },
  M: { width: 280, height: 280 },
  L: { width: 360, height: 360 },
});
const PROPORTIONAL_RATIOS = Object.freeze([6, 9, 13, 18]);
const DEFAULT_THEME_ID = "renmi";
const SETTINGS_PATH = path.join(app.getPath("userData"), "renmi-prefs.json");

let win = null;
let hitWin = null;
let tray = null;
let settingsWindowRuntime = null;
let studyWindowRuntime = null;
let studyIpcRuntime = null;
let authRuntime = null;
let themeRuntime = null;
let themeFadeSequencer = null;
let petWindowRuntime = null;
let petState = null;
let miniRuntime = null;
let roamRuntime = null;
let tickRuntime = null;
let ambientRuntime = null;
let studyRuntime = null;
let updater = null;
let isQuitting = false;
let menuOpen = false;
let idlePaused = false;
let lowPowerIdlePaused = false;
let mouseOverPet = false;
let accessoryMirrored = false;
let lastSoundAt = 0;
let studyBroadcastTimer = null;
let profileAutosaveTimer = null;
let profilePullAt = 0;
let profileSaveChain = Promise.resolve();
let activeProfileId = "";
let activeProfileUpdatedAt = "";
let activeProfileSignature = "";
let activeThemeFallback = null;
let profileApplying = false;
let registeredShortcuts = new Map();

function isLiveWindow(value) {
  return !!value && (typeof value.isDestroyed !== "function" || !value.isDestroyed());
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeScreenPoint(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) return null;
  return { x: value.x, y: value.y };
}

function sendToRenderer(channel, ...args) {
  if (isLiveWindow(win) && win.webContents && !win.webContents.isDestroyed()) {
    try { win.webContents.send(channel, ...args); } catch {}
  }
}

function sendToHitWin(channel, ...args) {
  if (isLiveWindow(hitWin) && hitWin.webContents && !hitWin.webContents.isDestroyed()) {
    try { hitWin.webContents.send(channel, ...args); } catch {}
  }
}

function setMainWindowsVisible(visible) {
  for (const current of [win, hitWin]) {
    if (!isLiveWindow(current)) continue;
    try { visible ? current.showInactive() : current.hide(); } catch {}
  }
}

function getPrimaryWorkAreaSafe() {
  try {
    const display = screen.getPrimaryDisplay();
    return display && display.workArea ? display.workArea : null;
  } catch {
    return null;
  }
}

function getNearestWorkArea(x, y) {
  try {
    return findNearestWorkArea(screen.getAllDisplays(), getPrimaryWorkAreaSafe(), x, y);
  } catch {
    return getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
  }
}

function isProportionalMode(size) {
  return typeof size === "string" && size.startsWith("P:");
}

function getProportionalRatio(size) {
  const parsed = Number.parseFloat(String(size || "").slice(2));
  return Number.isFinite(parsed) ? parsed : 9;
}

function getCurrentPixelSize(workArea) {
  const size = settingsController.get("size");
  if (!isProportionalMode(size)) return SIZES[size] || SIZES.M;
  return getProportionalPixelSize(getProportionalRatio(size), workArea);
}

function getEffectiveCurrentPixelSize(workArea) {
  return getCurrentPixelSize(workArea);
}

function computeFinalDragBounds(bounds, size) {
  if (!bounds || !size) return bounds;
  const wa = getNearestWorkArea(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  return {
    ...bounds,
    width: size.width,
    height: size.height,
    x: Math.round(Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - size.width))),
    y: Math.round(Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - size.height))),
  };
}

function getCurrentTheme() {
  return themeRuntime && themeRuntime.getActiveTheme();
}

function getIdleVisualChoice() {
  return resolveIdleVisualChoice(getCurrentTheme(), settingsController.get("idleVisual"));
}

function getEffectiveAccessoryPayload() {
  const theme = getCurrentTheme();
  const snapshot = settingsController.getSnapshot();
  const id = getEffectivePetAccessoryIdForTheme({
    petAccessory: snapshot.petAccessory,
    holidayAccessoryEnabled: snapshot.holidayAccessoryEnabled,
    themeId: theme && theme._id,
  });
  return buildPetAccessoryPayload(id, theme);
}

function buildRendererThemeConfig() {
  const config = themeRuntime && themeRuntime.getRendererConfig();
  if (!config) return config;
  const theme = getCurrentTheme();
  const snapshot = settingsController.getSnapshot();
  const tintId = getPetTintIdForTheme(snapshot.petTint, theme && theme._id);
  const accessoryId = getEffectivePetAccessoryIdForTheme({
    petAccessory: snapshot.petAccessory,
    holidayAccessoryEnabled: snapshot.holidayAccessoryEnabled,
    themeId: theme && theme._id,
  });
  config.idleDefaultVisual = getIdleVisualChoice();
  config.petTintPayload = resolvePetTintPayload(tintId, theme);
  config.petTintSaturationValue = getPetTintSaturationForTheme(snapshot.petTintSaturation, theme);
  config.accessoryPayload = resolvePetAccessoryPayload(accessoryId, theme);
  return config;
}

function syncRendererTheme() {
  sendToRenderer("theme-config", buildRendererThemeConfig());
  const theme = getCurrentTheme();
  const snapshot = settingsController.getSnapshot();
  const tintId = getPetTintIdForTheme(snapshot.petTint, theme && theme._id);
  const accessoryId = getEffectivePetAccessoryIdForTheme({
    petAccessory: snapshot.petAccessory,
    holidayAccessoryEnabled: snapshot.holidayAccessoryEnabled,
    themeId: theme && theme._id,
  });
  sendToRenderer("pet-tint-change", resolvePetTintPayload(tintId, theme));
  sendToRenderer("pet-tint-saturation-change", getPetTintSaturationForTheme(snapshot.petTintSaturation, theme));
  sendToRenderer("pet-accessory-change", resolvePetAccessoryPayload(accessoryId, theme));
  sendToRenderer("low-power-idle-mode-change", settingsController.get("lowPowerIdleMode") === true);
  if (miniRuntime && miniRuntime.getMiniMode()) miniRuntime.syncContainedClip();
  if (ambientRuntime) ambientRuntime.syncToRenderer();
}

function syncHitStateAfterLoad() {
  sendToHitWin("renmi:hit-state-sync", {
    currentSvg: petState && petState.getCurrentSvg(),
    currentState: petState && petState.getCurrentState(),
    miniMode: !!(miniRuntime && miniRuntime.getMiniMode()),
  });
}

function syncRendererStateAfterLoad() {
  syncRendererTheme();
  if (petState) sendToRenderer("state-change", petState.getCurrentState(), petState.getCurrentSvg());
  if (miniRuntime && miniRuntime.getMiniMode()) {
    sendToRenderer("mini-mode-change", true, miniRuntime.getMiniEdge());
  }
}

function syncAccessoryMirror(value) {
  const next = value === true;
  if (accessoryMirrored === next) return;
  accessoryMirrored = next;
  if (petWindowRuntime) petWindowRuntime.syncHitWin();
}

function playSound(name) {
  if (settingsController.get("soundMuted") === true) return false;
  const now = Date.now();
  if (now - lastSoundAt < 1000) return false;
  const url = themeRuntime && themeRuntime.getSoundUrl(name);
  if (!url) return false;
  lastSoundAt = now;
  sendToRenderer("play-sound", {
    url,
    volume: Number(settingsController.get("soundVolume")) || 1,
  });
  return true;
}

function syncSoundPreloads() {
  const urls = ["complete", "confirm"]
    .map((name) => themeRuntime && themeRuntime.getSoundUrl(name))
    .filter((url, index, all) => url && all.indexOf(url) === index);
  if (urls.length) sendToRenderer("preload-sounds", { urls });
}

function applyPetSize(sizeKey) {
  if (!isLiveWindow(win)) return { status: "ok", noop: true };
  const size = getCurrentPixelSize();
  if (miniRuntime && miniRuntime.getMiniMode()) {
    miniRuntime.handleResize(sizeKey);
    return { status: "ok" };
  }
  const current = petWindowRuntime.getPetWindowBounds();
  const next = computeFinalDragBounds(current, size);
  petWindowRuntime.applyPetWindowBounds(next, { force: true });
  petWindowRuntime.syncHitWin();
  return { status: "ok" };
}

function writeOpenAtLogin(enabled) {
  if (isLinux) {
    const launchPath = path.join(__dirname, "..", "launch.js");
    const execCmd = app.isPackaged ? `"${app.getPath("exe")}"` : `node "${launchPath}"`;
    const { linuxSetOpenAtLogin } = require("./login-item");
    linuxSetOpenAtLogin(enabled, { execCmd });
    return { status: "ok" };
  }
  const { getLoginItemSettings } = require("./login-item");
  app.setLoginItemSettings(getLoginItemSettings({
    isPackaged: app.isPackaged,
    openAtLogin: enabled,
    execPath: process.execPath,
    appPath: app.getAppPath(),
  }));
  return { status: "ok" };
}

function readOpenAtLogin() {
  if (isLinux) {
    try { return require("./login-item").linuxGetOpenAtLogin(); } catch { return false; }
  }
  try {
    const { getLoginItemSettings } = require("./login-item");
    return app.getLoginItemSettings(app.isPackaged
      ? {}
      : { path: process.execPath, args: [app.getAppPath()] }).openAtLogin;
  } catch {
    return false;
  }
}

function registerRenmiShortcut(next, previous) {
  if (previous) globalShortcut.unregister(previous);
  if (!next) return { status: "ok" };
  let registered = false;
  try { registered = globalShortcut.register(next, togglePetVisibility); } catch {}
  if (!registered) {
    if (previous) {
      try { globalShortcut.register(previous, togglePetVisibility); } catch {}
    }
    return { status: "error", message: "shortcut is unavailable" };
  }
  registeredShortcuts.set("togglePet", next);
  return { status: "ok" };
}

function unregisterRenmiShortcut(previous) {
  if (previous) globalShortcut.unregister(previous);
  registeredShortcuts.delete("togglePet");
  return { status: "ok" };
}

function availableThemes() {
  return themeLoader.discoverThemes()
    .filter((item) => item && item.id !== "clawd" && item.id !== "template")
    .map((item) => item.id);
}

function isThemeAvailable(themeId) {
  return availableThemes().includes(themeId);
}

function syncRenmiRuntimeFromSettings() {
  if (ambientRuntime) ambientRuntime.onPrefsUpdate(settingsController.getSnapshot());
  syncRendererTheme();
  syncSoundPreloads();
  if (settingsWindowRuntime) settingsWindowRuntime.applyTitleToWindow();
  if (studyWindowRuntime) studyWindowRuntime.sendI18n();
}

function repositionStudyWindowNearPet(followOverride) {
  const follow = typeof followOverride === "boolean"
    ? followOverride
    : settingsController.get("studyFollowPet") === true;
  if (!follow) return false;
  if (!studyWindowRuntime || typeof studyWindowRuntime.repositionNearPet !== "function") return false;
  return studyWindowRuntime.repositionNearPet({ follow });
}

function togglePetVisibility() {
  if (!petWindowRuntime) return false;
  return petWindowRuntime.togglePetVisibility();
}

function openSettings() {
  settingsWindowRuntime && settingsWindowRuntime.open();
}

function openStudy() {
  studyWindowRuntime && studyWindowRuntime.showStudyDashboard();
}

function buildTrayTemplate() {
  const currentTheme = getCurrentTheme();
  const themeItems = availableThemes().map((themeId) => ({
    label: themeId === "renmi" ? "Renmi" : themeId === "calico" ? "Calico" : themeId,
    type: "radio",
    checked: currentTheme && currentTheme._id === themeId,
    click: () => void settingsController.applyCommand("setThemeSelection", { themeId }),
  }));
  const isMini = !!(miniRuntime && miniRuntime.getMiniMode());
  const account = authRuntime && authRuntime.getSession();
  return [
    { label: "Settings", click: openSettings },
    { label: "Study", click: openStudy },
    { type: "separator" },
    { label: "Theme", submenu: themeItems },
    { label: isMini ? "Exit mini mode" : "Mini mode", enabled: !settingsController.get("disableMiniMode"), click: () => {
      if (isMini) miniRuntime.exitMiniMode();
      else miniRuntime.enterMiniViaMenu();
    } },
    { label: "Show / hide Renmi", click: togglePetVisibility },
    { label: settingsController.get("ambientEnabled") ? "Disable ambient sound" : "Enable ambient sound", click: () => {
      void settingsController.applyUpdate("ambientEnabled", settingsController.get("ambientEnabled") !== true);
    } },
    { type: "separator" },
    account
      ? { label: `Sign out (${account.user && account.user.email ? account.user.email : "account"})`, click: () => void authRuntime.logout() }
      : { label: "Sign in / register", click: () => authRuntime && authRuntime.openAuthWindow() },
    { label: "Check for updates", click: () => updater && updater.checkForUpdates(true) },
    { type: "separator" },
    { label: "Quit Renmi", click: () => app.quit() },
  ];
}

function rebuildMenus() {
  if (!tray || tray.isDestroyed?.()) return;
  const menu = Menu.buildFromTemplate(buildTrayTemplate());
  tray.setContextMenu(menu);
}

function showContextMenu() {
  if (!tray) {
    const menu = Menu.buildFromTemplate(buildTrayTemplate());
    menu.popup({ window: hitWin || win });
    return;
  }
  rebuildMenus();
  tray.popUpContextMenu();
}

function createTray() {
  if (tray) return;
  const iconPath = isMac
    ? path.join(__dirname, "..", "assets", "tray-iconTemplate.png")
    : path.join(__dirname, "..", "assets", "icon.png");
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  tray.setToolTip("Renmi");
  tray.on("click", togglePetVisibility);
  rebuildMenus();
}

function destroyTray() {
  if (!tray) return;
  try { tray.destroy(); } catch {}
  tray = null;
}

function setPetState(next, svg) {
  const result = petState.applyState(next, svg);
  if (ambientRuntime) ambientRuntime.onStateChanged(result.state);
  return result;
}

function syncStudyPetState() {
  if (!studyRuntime || !petState) return;
  const pomodoro = studyRuntime.getSnapshot().pomodoro;
  if (pomodoro && pomodoro.running && pomodoro.phase === "focus") setPetState("working");
  else if (petState.getCurrentState() === "working") setPetState("idle");
}

function resetPetInteractionStateAfterRendererGone() {
  // A renderer exit can happen while the hit window still has a pointer
  // capture. Clear the main-process side of that handshake before reloading;
  // otherwise the next drag can be treated as a continuation and cursor
  // polling/visibility state can remain paused indefinitely.
  idlePaused = false;
  mouseOverPet = false;
  petWindowRuntime?.setDragLocked(false);
  petWindowRuntime?.clearDragSnapshot();
}

function getStudyI18n() {
  const lang = SUPPORTED_LANGS.includes(settingsController.get("lang"))
    ? settingsController.get("lang")
    : "en";
  return { lang, translations: { ...(i18n[lang] || i18n.en) } };
}

const settingsController = createSettingsController({
  prefsPath: SETTINGS_PATH,
  prefs: renmiPrefs,
  updates: renmiActions.updateRegistry,
  commands: renmiActions.commandRegistry,
  injectedDeps: {
    syncAmbient: () => ({ status: "ok" }),
    syncSound: () => ({ status: "ok" }),
    syncPetCustomization: () => ({ status: "ok" }),
    syncLanguage: () => ({ status: "ok" }),
    syncRoam: () => ({ status: "ok" }),
    syncStudyPanelTracking: (value) => {
      // Settings effects run before the controller commits the new value, so
      // pass the validated value explicitly instead of reading the old
      // snapshot through settingsController.get().
      repositionStudyWindowNearPet(value);
      return { status: "ok" };
    },
    setOpenAtLogin: writeOpenAtLogin,
    applySize: applyPetSize,
    isThemeAvailable,
    activateTheme: (themeId, variantId) => themeRuntime.activateTheme(themeId, variantId),
    isIdleVisualAllowed: (themeId, file) => {
      if (!isThemeAvailable(themeId)) return false;
      if (!file) return true;
      const theme = themeLoader.loadTheme(themeId, { variant: "default" });
      return Array.isArray(theme.idleAnimations) && theme.idleAnimations.some((item) => item.file === file);
    },
    registerShortcut: registerRenmiShortcut,
    unregisterShortcut: unregisterRenmiShortcut,
    hidePet: () => petWindowRuntime && petWindowRuntime.setPetHidden(true),
  },
});

// Theme and window runtimes are constructed with lazy callbacks because their
// event handlers can run only after Electron has created the windows.
themeLoader.init(__dirname, app.getPath("userData"));
themeFadeSequencer = createThemeFadeSequencer({
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getRestoreOpacity: () => 1,
});
themeRuntime = createThemeRuntime({
  themeLoader,
  settingsController,
  fs,
  path,
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getStateRuntime: () => petState,
  getTickRuntime: () => tickRuntime,
  getMiniRuntime: () => miniRuntime,
  getFadeSequencer: () => themeFadeSequencer,
  getPetWindowBounds: () => petWindowRuntime && petWindowRuntime.getPetWindowBounds(),
  applyPetWindowBounds: (bounds, options) => petWindowRuntime && petWindowRuntime.applyPetWindowBounds(bounds, options),
  computeFinalDragBounds,
  clampToScreenVisual: (x, y, width, height) => petWindowRuntime
    ? petWindowRuntime.clampToScreenVisual(x, y, width, height)
    : { x, y },
  flushRuntimeStateToPrefs: () => settingsController.persist(),
  syncHitStateAfterLoad,
  syncRendererStateAfterLoad,
  syncHitWin: () => petWindowRuntime && petWindowRuntime.syncHitWin(),
  startMainTick: () => tickRuntime && tickRuntime.startMainTick(),
  rebuildAllMenus: rebuildMenus,
});

let initialThemeId = settingsController.get("theme");
if (!isThemeAvailable(initialThemeId)) {
  initialThemeId = DEFAULT_THEME_ID;
  settingsController.hydrate({ theme: DEFAULT_THEME_ID, themeVariant: {} });
}
const initialVariants = settingsController.get("themeVariant") || {};
themeRuntime.loadInitialTheme(initialThemeId, {
  variant: initialVariants[initialThemeId] || "default",
  overrides: (settingsController.get("themeOverrides") || {})[initialThemeId] || null,
  fallbackThemeId: DEFAULT_THEME_ID,
});

petState = createPetState({
  getTheme: getCurrentTheme,
  sendToRenderer,
  onStateChanged: (state) => {
    if (ambientRuntime) ambientRuntime.onStateChanged(state);
  },
});

petWindowRuntime = createPetWindowRuntime({
  screen,
  isWin,
  isMac,
  isLinux,
  isRenmiProfile: true,
  linuxWindowType: "toolbar",
  topmostLevel: "pop-up-menu",
  getRenderWindow: () => win,
  getHitWindow: () => hitWin,
  getSettingsWindow: () => settingsWindowRuntime && settingsWindowRuntime.getWindow(),
  getActiveTheme: getCurrentTheme,
  getCurrentState: () => petState.getCurrentState(),
  getCurrentSvg: () => petState.getCurrentSvg(),
  getCurrentHitBox: () => petState.getCurrentHitBox(),
  getCurrentAccessoryPayload: getEffectiveAccessoryPayload,
  getAccessoryMirrored: () => accessoryMirrored,
  getMiniMode: () => !!(miniRuntime && miniRuntime.getMiniMode()),
  getMiniTransitioning: () => !!(miniRuntime && miniRuntime.getMiniTransitioning()),
  getMiniContainedSeam: () => miniRuntime && miniRuntime.getContainedSeam(),
  getMiniPeekOffset: () => miniRuntime ? miniRuntime.PEEK_OFFSET : 0,
  getCurrentPixelSize,
  getEffectiveCurrentPixelSize,
  getAllowEdgePinning: () => settingsController.get("allowEdgePinning") === true,
  getPrimaryWorkAreaSafe,
  getNearestWorkArea,
  sendToRenderer,
  keepOutOfTaskbar,
  buildTrayMenu: rebuildMenus,
  buildContextMenu: rebuildMenus,
  reapplyMacVisibility: () => {},
  reassertWinTopmost: () => {},
  scheduleHwndRecovery: () => {},
  isMiniAnimating: () => !!(miniRuntime && miniRuntime.getIsAnimating()),
  isRoamAnimating: () => !!(roamRuntime && roamRuntime.isRoamAnimating()),
  repositionStudyWindow: repositionStudyWindowNearPet,
  isNearWorkAreaEdge: () => false,
  flushRuntimeStateToPrefs: () => settingsController.persist(),
  handleMiniDisplayChange: () => miniRuntime && miniRuntime.handleDisplayChange(),
  notifyMiniTopologyChangedDuringTransition: () => miniRuntime && miniRuntime.notifyTopologyChangedDuringTransition(),
  exitMiniMode: () => miniRuntime && miniRuntime.exitMiniMode(),
});

miniRuntime = initMini({
  get theme() { return getCurrentTheme(); },
  get win() { return win; },
  get currentSize() { return settingsController.get("size"); },
  get doNotDisturb() { return false; },
  set doNotDisturb(_value) {},
  get currentState() { return petState.getCurrentState(); },
  SIZES,
  getCurrentPixelSize,
  getEffectiveCurrentPixelSize,
  getPixelSizeFor: getCurrentPixelSize,
  isProportionalMode,
  sendToRenderer,
  sendToHitWin,
  syncHitWin: () => petWindowRuntime.syncHitWin(),
  applyState: setPetState,
  resolveDisplayState: () => petState.getCurrentState(),
  getSvgOverride: () => null,
  stopWakePoll: () => {},
  clampToScreenVisual: (x, y, width, height) => petWindowRuntime.clampToScreenVisual(x, y, width, height),
  getNearestWorkArea,
  getPetWindowBounds: () => petWindowRuntime.getPetWindowBounds(),
  applyPetWindowBounds: (bounds, options) => petWindowRuntime.applyPetWindowBounds(bounds, options),
  applyPetWindowPosition: (x, y, options) => petWindowRuntime.applyPetWindowPosition(x, y, options),
  setViewportOffsetY: (offset) => petWindowRuntime.setViewportOffsetY(offset),
  releaseReconcileProtection: () => petWindowRuntime.releaseReconcileProtection(),
  buildContextMenu: rebuildMenus,
  buildTrayMenu: rebuildMenus,
});

roamRuntime = initRoam({
  get win() { return win; },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  getPetWindowBounds: () => petWindowRuntime.getPetWindowBounds(),
  applyPetWindowBounds: (bounds, options) => petWindowRuntime.applyPetWindowBounds(bounds, options),
  getEffectiveCurrentPixelSize,
  syncHitWin: () => petWindowRuntime.syncHitWin(),
  releaseReconcileProtection: () => petWindowRuntime.releaseReconcileProtection(),
  getNearestWorkArea,
  clampToScreenVisual: (x, y, width, height) => petWindowRuntime.clampToScreenVisual(x, y, width, height),
  getMiniMode: () => miniRuntime.getMiniMode(),
  getCurrentState: () => petState.getCurrentState(),
  get miniTransitioning() { return miniRuntime.getMiniTransitioning(); },
  applyState: setPetState,
  setState: setPetState,
  setRoamHeading: (left) => sendToRenderer("roam-heading", left === true),
  isImeEditingActive: () => false,
});
roamRuntime.setEnabled(settingsController.get("freeRoam") === true);
roamRuntime.setConstrainAxis(settingsController.get("roamConstrainAxis") === true);

tickRuntime = initTick({
  get theme() { return getCurrentTheme(); },
  get win() { return win; },
  getPetWindowBounds: () => petWindowRuntime.getPetWindowBounds(),
  get currentState() { return petState.getCurrentState(); },
  get currentSvg() { return petState.getCurrentSvg(); },
  get miniMode() { return miniRuntime.getMiniMode(); },
  get miniTransitioning() { return miniRuntime.getMiniTransitioning(); },
  get dragLocked() { return petWindowRuntime.isDragLocked(); },
  get menuOpen() { return menuOpen; },
  get idlePaused() { return idlePaused; },
  get lowPowerIdleMode() { return settingsController.get("lowPowerIdleMode") === true; },
  get lowPowerIdlePaused() { return lowPowerIdlePaused; },
  get isAnimating() { return miniRuntime.getIsAnimating(); },
  get miniSleepPeeked() { return miniRuntime.getMiniSleepPeeked(); },
  set miniSleepPeeked(value) { miniRuntime.setMiniSleepPeeked(value); },
  get miniPeeked() { return miniRuntime.getMiniPeeked(); },
  set miniPeeked(value) { miniRuntime.setMiniPeeked(value); },
  get mouseOverPet() { return mouseOverPet; },
  set mouseOverPet(value) { mouseOverPet = !!value; },
  get forceEyeResend() { return false; },
  set forceEyeResend(_value) {},
  forceEyeResendBoostUntil: 0,
  startupRecoveryActive: false,
  sendToRenderer,
  sendToHitWin,
  setState: setPetState,
  applyState: setPetState,
  getIdleVisualChoice,
  miniPeekIn: () => miniRuntime.miniPeekIn(),
  miniPeekOut: () => miniRuntime.miniPeekOut(),
  getObjRect: (bounds) => petWindowRuntime.getObjRect(bounds),
  getHitRectScreen: (bounds) => petWindowRuntime.getHitRectScreen(bounds),
  getAssetPointerPayload: (bounds, point) => petWindowRuntime.getAssetPointerPayload(bounds, point),
  get roam() { return roamRuntime; },
});

themeFadeSequencer.getRestoreOpacity = () => 1;

ambientRuntime = createAmbientRuntime();
ambientRuntime.init({
  getPrefs: () => settingsController.getSnapshot(),
  getDoNotDisturb: () => false,
  sendToRenderer,
});

studyRuntime = createStudyRuntime({
  dataPath: path.join(app.getPath("userData"), "study-data.json"),
  onPhaseChange: syncStudyPetState,
  onFocusComplete: ({ taskFinished }) => {
    setPetState(taskFinished ? "attention" : "idle");
    playSound(taskFinished ? "complete" : "confirm");
  },
});

settingsWindowRuntime = createSettingsWindowRuntime({
  app,
  BrowserWindow,
  fs,
  isWin,
  nativeTheme,
  path,
  isRenmiProfile: true,
  settingsHtmlPath: path.join(__dirname, "settings-renmi.html"),
  preloadPath: path.join(__dirname, "preload-settings-renmi.js"),
  getSavedBounds: () => null,
  onSaveBounds: () => null,
  getPetWindowBounds: () => petWindowRuntime.getPetWindowBounds(),
  getNearestWorkArea,
  getTextScale: () => settingsController.get("textScale") || 1,
  getTitle: () => "Renmi Settings",
});

studyWindowRuntime = createStudyWindowRuntime({
  t: (key) => (i18n[settingsController.get("lang")] || i18n.en)[key] || key,
  getStudySnapshot: () => studyRuntime.getSnapshot(),
  getI18n: getStudyI18n,
  shouldFollowPet: () => settingsController.get("studyFollowPet") === true,
  getPetWindowBounds: () => petWindowRuntime.getPetWindowBounds(),
  getNearestWorkArea,
  getTextScale: () => settingsController.get("textScale") || 1,
  iconPath: settingsWindowRuntime.getIconPath(),
});
studyIpcRuntime = registerStudyIpc({
  ipcMain,
  studyRuntime,
  getStudyWindow: () => studyWindowRuntime.getWindow(),
  broadcast: (snapshot) => studyWindowRuntime.broadcastStudySnapshot(snapshot),
});

// The Study preload historically asks for this channel. It is scoped to the
// Study window only and is not the removed Sessions Dashboard interface.
ipcMain.handle("study:get-i18n", (event) => {
  const studyWindow = studyWindowRuntime.getWindow();
  if (!studyWindow || event.sender !== studyWindow.webContents) return {};
  return getStudyI18n();
});

function syncSettingsChanged(payload) {
  const settingsWindow = settingsWindowRuntime && settingsWindowRuntime.getWindow();
  if (isLiveWindow(settingsWindow) && settingsWindow.webContents && !settingsWindow.webContents.isDestroyed()) {
    settingsWindow.webContents.send("renmi:settings-changed", payload);
  }
  syncRenmiRuntimeFromSettings();
  repositionStudyWindowNearPet();
  rebuildMenus();
}
settingsController.subscribe(syncSettingsChanged);
settingsController.subscribeKey("freeRoam", (value) => roamRuntime.setEnabled(value === true));
settingsController.subscribeKey("roamConstrainAxis", (value) => roamRuntime.setConstrainAxis(value === true));

// Keep updater checks available from the tray and Settings without creating
// any task or agent notification surface.
try {
  const initUpdater = require("./updater");
  updater = initUpdater({
    t: (key) => (i18n[settingsController.get("lang")] || i18n.en)[key] || key,
    lang: settingsController.get("lang"),
    miniMode: false,
    doNotDisturb: false,
    updatesDisabled: false,
    getUpdatePref: (key) => settingsController.get(key),
    setUpdatePref: (key, value) => settingsController.applyUpdate(key, value),
    rebuildAllMenus: rebuildMenus,
    showUpdateBubble: () => {},
    hideUpdateBubble: () => {},
    setUpdateVisualState: () => {},
    resetSoundCooldown: () => { lastSoundAt = 0; },
    applyState: setPetState,
    resolveDisplayState: () => petState.getCurrentState(),
    getSvgOverride: () => null,
    onUpdateCheckStatusChanged: () => rebuildMenus(),
    updateLog: (...args) => console.warn("Renmi updater:", ...args),
  }, { app, shell });
} catch (error) {
  console.warn("Renmi updater unavailable:", error && error.message);
}

function readAccountProfileCache() {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "account-profile-cache.json"), "utf8"));
    return value && typeof value.ownerId === "string" ? value : {};
  } catch {
    return {};
  }
}

function writeAccountProfileCache(ownerId) {
  if (!ownerId) return;
  const target = path.join(app.getPath("userData"), "account-profile-cache.json");
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, ownerId })}\n`, { mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function buildCurrentAccountProfile() {
  const settings = settingsController.getSnapshot();
  const theme = getCurrentTheme();
  const themeId = theme && theme._id || settings.theme || DEFAULT_THEME_ID;
  const fallback = activeThemeFallback && theme && theme._id === activeThemeFallback.fallbackThemeId
    ? activeThemeFallback
    : null;
  return sanitizeProfile({
    pet: {
      themeId: fallback ? fallback.requestedThemeId : themeId,
      variantId: fallback ? fallback.requestedVariantId : (theme && theme._variantId || "default"),
      tintId: fallback ? fallback.tintId : ((settings.petTint || {})[themeId] || "none"),
      accessoryId: fallback ? fallback.accessoryId : ((settings.petAccessory || {})[themeId] || "none"),
      holidayAccessoryEnabled: fallback
        ? fallback.holidayAccessoryEnabled
        : (settings.holidayAccessoryEnabled || {})[themeId] === true,
      idleVisual: fallback ? fallback.idleVisual : ((settings.idleVisual || {})[themeId] || ""),
    },
    study: studyRuntime.getSnapshot(),
  });
}

function profileSignature(profile) {
  return JSON.stringify(sanitizeProfile(profile));
}

async function applyAccountProfile(rawProfile) {
  const profile = sanitizeProfile(rawProfile);
  const pet = profile.pet;
  profileApplying = true;
  let fallback = null;
  try {
    const variants = { [pet.themeId]: pet.variantId };
    let resolvedThemeId = pet.themeId;
    let result = await settingsController.applyCommand("setThemeSelection", {
      themeId: pet.themeId,
      variantId: pet.variantId,
    });
    if (!result || result.status !== "ok") {
      fallback = {
        fallbackThemeId: DEFAULT_THEME_ID,
        requestedThemeId: pet.themeId,
        requestedVariantId: pet.variantId,
        tintId: pet.tintId,
        accessoryId: pet.accessoryId,
        holidayAccessoryEnabled: pet.holidayAccessoryEnabled,
        idleVisual: pet.idleVisual,
      };
      resolvedThemeId = DEFAULT_THEME_ID;
      result = await settingsController.applyCommand("setThemeSelection", {
        themeId: DEFAULT_THEME_ID,
        variantId: "default",
      });
    }
    if (!result || result.status !== "ok") throw new Error(result.message || "theme activation failed");
    settingsController.hydrate({
      petTint: pet.tintId === "none" ? {} : { [resolvedThemeId]: pet.tintId },
      petAccessory: pet.accessoryId === "none" ? {} : { [resolvedThemeId]: pet.accessoryId },
      holidayAccessoryEnabled: pet.holidayAccessoryEnabled ? { [resolvedThemeId]: true } : {},
      idleVisual: pet.idleVisual ? { [resolvedThemeId]: pet.idleVisual } : {},
      themeVariant: variants,
    });
    studyRuntime.hydrate(profile.study);
    syncRenmiRuntimeFromSettings();
    return profile;
  } finally {
    profileApplying = false;
    activeThemeFallback = fallback;
  }
}

async function hydrateAccountProfileForUser(user) {
  if (!user || user.role !== "user" || !authRuntime) return;
  const remote = await authRuntime.getProfile();
  const cache = readAccountProfileCache();
  const localStudy = studyRuntime.getSnapshot();
  const migrate = !cache.ownerId
    && hasMeaningfulStudyState(localStudy)
    && !hasMeaningfulStudyState(remote.profile && remote.profile.study);
  const profile = migrate ? { ...clone(remote.profile), study: localStudy } : remote.profile;
  await applyAccountProfile(profile);
  activeProfileId = user.id;
  activeProfileUpdatedAt = remote.profileUpdatedAt || "";
  activeProfileSignature = profileSignature(buildCurrentAccountProfile());
  profilePullAt = Date.now();
  writeAccountProfileCache(user.id);
  if (migrate) await saveAccountProfile({ force: true });
}

function saveAccountProfile({ force = false } = {}) {
  if (!activeProfileId || !authRuntime || !authRuntime.getSession()) return Promise.resolve(null);
  const owner = activeProfileId;
  const profile = buildCurrentAccountProfile();
  const signature = profileSignature(profile);
  if (!force && signature === activeProfileSignature) return Promise.resolve(null);
  profileSaveChain = profileSaveChain.catch(() => {}).then(async () => {
    if (!activeProfileId || activeProfileId !== owner || !authRuntime) return null;
    try {
      const result = await authRuntime.updateProfile(profile, activeProfileUpdatedAt || undefined);
      activeProfileUpdatedAt = result.profileUpdatedAt || activeProfileUpdatedAt;
      activeProfileSignature = profileSignature(result.profile || profile);
      profilePullAt = Date.now();
      return result;
    } catch (error) {
      if (error && error.code === "profile_conflict" && error.details && error.details.profile) {
        await applyAccountProfile(error.details.profile);
        activeProfileUpdatedAt = error.details.profile.profileUpdatedAt || activeProfileUpdatedAt;
        activeProfileSignature = profileSignature(buildCurrentAccountProfile());
      }
      console.warn("Renmi account profile save failed:", error && error.message);
      return null;
    }
  });
  return profileSaveChain;
}

async function pullAccountProfileIfNeeded() {
  if (!activeProfileId || !authRuntime || !authRuntime.getSession()) return;
  if (profileSignature(buildCurrentAccountProfile()) !== activeProfileSignature) {
    await saveAccountProfile();
    return;
  }
  if (Date.now() - profilePullAt < 30000) return;
  profilePullAt = Date.now();
  try {
    const remote = await authRuntime.getProfile();
    if (remote.profileUpdatedAt && remote.profileUpdatedAt !== activeProfileUpdatedAt) {
      await applyAccountProfile(remote.profile);
      activeProfileUpdatedAt = remote.profileUpdatedAt;
      activeProfileSignature = profileSignature(buildCurrentAccountProfile());
    }
  } catch (error) {
    console.warn("Renmi account profile refresh failed:", error && error.message);
  }
}

async function deactivateAccountProfile(user) {
  if (!user || user.role !== "user" || activeProfileId !== user.id) return;
  await saveAccountProfile({ force: true });
  activeProfileId = "";
  activeProfileUpdatedAt = "";
  activeProfileSignature = "";
  profilePullAt = 0;
  activeThemeFallback = null;
  await applyAccountProfile(defaultProfile());
}

function createPetWindows() {
  let prefs = settingsController.getSnapshot();
  if (SIZES[prefs.size]) {
    const area = getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA;
    const ratio = Math.max(1, Math.min(75, Math.round(SIZES[prefs.size].width / area.width * 100)));
    settingsController.applyUpdate("size", `P:${ratio}`);
    prefs = settingsController.getSnapshot();
  }
  const launchArea = getLaunchSizingWorkArea(
    prefs,
    getPrimaryWorkAreaSafe() || SYNTHETIC_WORK_AREA,
    getNearestWorkArea,
  );
  const size = getLaunchPixelSize(prefs, getCurrentPixelSize(launchArea));
  const placement = petWindowRuntime.resolveStartupPlacement(prefs, size, {
    restoreMiniFromPrefs: (snapshot, pixelSize) => miniRuntime.restoreFromPrefs(snapshot, pixelSize),
  });
  petWindowRuntime.createRenderWindow({
    BrowserWindow,
    size,
    initialWindowBounds: placement.initialWindowBounds,
    initialVirtualBounds: placement.initialVirtualBounds,
    preloadPath: path.join(__dirname, "preload-renmi.js"),
    loadFilePath: path.join(__dirname, "index.html"),
    themeConfig: buildRendererThemeConfig(),
    setRenderWindow: (created) => { win = created; },
    isQuitting: () => isQuitting,
  });
  hitWin = petWindowRuntime.createHitWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, "preload-hit-renmi.js"),
    loadFilePath: path.join(__dirname, "hit-renmi.html"),
    hitThemeConfig: themeRuntime.getHitRendererConfig(),
    onDidFinishLoad: () => {
      sendToHitWin("theme-config", themeRuntime.getHitRendererConfig());
      syncHitStateAfterLoad();
    },
    onRenderProcessGone: (_details, owned) => {
      resetPetInteractionStateAfterRendererGone();
      petWindowRuntime.reloadWindowWebContents(owned, { crashKey: "renmi-hit", details: _details });
    },
  });
  win.on("move", () => {
    petWindowRuntime.onNativeGeometryEvent();
    repositionStudyWindowNearPet();
  });
  win.on("resize", () => {
    petWindowRuntime.onNativeGeometryEvent();
    repositionStudyWindowNearPet();
  });
  hitWin.on("move", () => petWindowRuntime.onHitNativeGeometryEvent());
  hitWin.on("resize", () => petWindowRuntime.onHitNativeGeometryEvent());
  win.webContents.on("did-start-loading", () => { accessoryMirrored = false; });
  win.webContents.on("did-finish-load", () => {
    syncRendererStateAfterLoad();
    syncHitStateAfterLoad();
    syncSoundPreloads();
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.warn("Renmi renderer exited:", details && details.reason);
    resetPetInteractionStateAfterRendererGone();
    petWindowRuntime.reloadWindowWebContents(win, { crashKey: "renmi-render", details });
  });
  screen.on("display-metrics-changed", () => petWindowRuntime.handleDisplayMetricsChanged());
  screen.on("display-added", () => petWindowRuntime.handleDisplayAdded());
  screen.on("display-removed", () => petWindowRuntime.handleDisplayRemoved());
}

function finalizePetDrag() {
  // Make drag-end self-contained. Renderer IPC is ordered in practice, but a
  // lost-capture/blur path can deliver the end notification without the
  // matching unlock having completed yet. Releasing first lets the final
  // bounds write update the hit window immediately instead of leaving it at
  // the old location.
  petWindowRuntime.setDragLocked(false);
  petWindowRuntime.clearDragSnapshot();

  const current = petWindowRuntime.getPetWindowBounds();
  if (current && !miniRuntime.getMiniMode() && !miniRuntime.getMiniTransitioning()) {
    const size = getEffectiveCurrentPixelSize();
    const finalBounds = petWindowRuntime.computeFinalDragBounds(current, size);
    if (finalBounds && (
      finalBounds.x !== current.x
      || finalBounds.y !== current.y
      || finalBounds.width !== current.width
      || finalBounds.height !== current.height
    )) {
      petWindowRuntime.applyPetWindowBounds(finalBounds);
    }
  }

  const saved = petWindowRuntime.getPetWindowBounds();
  if (saved) {
    settingsController.applyBulk({
      x: saved.x,
      y: saved.y,
      positionSaved: true,
    });
  }
  petWindowRuntime.syncHitWin();
  repositionStudyWindowNearPet();
}

function registerPetIpc() {
  const handle = (channel, listener) => {
    ipcMain.handle(channel, async (event, payload) => {
      if (!isLiveWindow(hitWin) || event.sender !== hitWin.webContents) {
        return { status: "error", message: "untrusted-pet-sender" };
      }
      return listener(payload, event);
    });
  };
  handle("renmi:show-context-menu", () => { showContextMenu(); return { status: "ok" }; });
  ipcMain.on("renmi:show-context-menu", (event) => {
    if (isLiveWindow(hitWin) && event.sender === hitWin.webContents) showContextMenu();
  });
  ipcMain.on("renmi:drag-lock", (event, value, point) => {
    if (!isLiveWindow(hitWin) || event.sender !== hitWin.webContents) return;
    const locked = value === true;
    petWindowRuntime.setDragLocked(locked);
    if (locked) {
      mouseOverPet = true;
      roamRuntime.cancelRoam();
      petWindowRuntime.beginDragSnapshot(normalizeScreenPoint(point));
    } else {
      petWindowRuntime.clearDragSnapshot();
      petWindowRuntime.syncHitWin();
      repositionStudyWindowNearPet();
    }
  });
  ipcMain.on("renmi:drag-move", (event, point) => {
    if (isLiveWindow(hitWin) && event.sender === hitWin.webContents) {
      petWindowRuntime.moveWindowForDrag(normalizeScreenPoint(point));
    }
  });
  ipcMain.on("renmi:drag-end", (event) => {
    if (isLiveWindow(hitWin) && event.sender === hitWin.webContents) {
      finalizePetDrag();
    }
  });
  ipcMain.on("renmi:exit-mini-mode", (event) => {
    if (isLiveWindow(hitWin) && event.sender === hitWin.webContents) miniRuntime.exitMiniMode();
  });
  ipcMain.on("renmi:click-reaction", (event, svg, duration) => {
    if (!isLiveWindow(hitWin) || event.sender !== hitWin.webContents) return;
    sendToRenderer("play-click-reaction", svg, duration);
  });
  ipcMain.on("renmi:start-drag-reaction", (event, direction) => {
    if (!isLiveWindow(hitWin) || event.sender !== hitWin.webContents) return;
    sendToRenderer("start-drag-reaction", direction);
  });
  ipcMain.on("renmi:end-drag-reaction", (event) => {
    if (!isLiveWindow(hitWin) || event.sender !== hitWin.webContents) return;
    sendToRenderer("end-drag-reaction");
  });
  ipcMain.on("renmi:pause-cursor-polling", (event) => {
    if (isLiveWindow(win) && event.sender === win.webContents) idlePaused = true;
  });
  ipcMain.on("renmi:resume-from-reaction", (event) => {
    if (isLiveWindow(win) && event.sender === win.webContents) idlePaused = false;
  });
  ipcMain.on("renmi:low-power-idle-paused", (event, value) => {
    if (isLiveWindow(win) && event.sender === win.webContents) lowPowerIdlePaused = value === true;
  });
  ipcMain.on("renmi:accessory-mirror", (event, value) => {
    if (isLiveWindow(win) && event.sender === win.webContents) syncAccessoryMirror(value === true);
  });
  ipcMain.on("renmi:sound-playback-error", (event, value) => {
    if (isLiveWindow(win) && event.sender === win.webContents) console.warn("Renmi sound playback failed:", value);
  });
  return handle;
}

function registerSettingsIpc() {
  const allowed = (event) => {
    const settingsWindow = settingsWindowRuntime && settingsWindowRuntime.getWindow();
    return isLiveWindow(settingsWindow) && event.sender === settingsWindow.webContents;
  };
  ipcMain.handle("renmi:settings-get-snapshot", (event) => allowed(event) ? settingsController.getSnapshot() : {});
  ipcMain.handle("renmi:settings-update", (event, payload) => {
    if (!allowed(event)) return { status: "error", message: "untrusted-settings-sender" };
    return settingsController.applyUpdate(payload && payload.key, payload && payload.value);
  });
  ipcMain.handle("renmi:settings-command", (event, payload) => {
    if (!allowed(event)) return { status: "error", message: "untrusted-settings-sender" };
    return settingsController.applyCommand(payload && payload.name, payload && payload.payload);
  });
  ipcMain.handle("renmi:settings-list-themes", (event) => {
    if (!allowed(event)) return [];
    const active = getCurrentTheme();
    return themeLoader.listThemesWithMetadata()
      .filter((theme) => theme && isThemeAvailable(theme.id))
      .map((theme) => {
        let idleVisuals = [];
        try {
          const loaded = themeLoader.loadTheme(theme.id, { variant: "default" });
          idleVisuals = Array.isArray(loaded.idleAnimations)
            ? loaded.idleAnimations.map((item) => item.file)
            : [];
        } catch {}
        return { ...theme, active: active && active._id === theme.id, idleVisuals };
      });
  });
  ipcMain.handle("renmi:settings-idle-visuals", (event, themeId) => {
    if (!allowed(event) || !isThemeAvailable(themeId)) return [];
    const theme = themeLoader.loadTheme(themeId, { variant: "default" });
    return Array.isArray(theme.idleAnimations) ? theme.idleAnimations.map((item) => item.file) : [];
  });
  ipcMain.handle("renmi:open-study", (event) => { if (allowed(event)) openStudy(); return { status: "ok" }; });
  ipcMain.handle("renmi:open-auth", (event) => { if (allowed(event)) authRuntime && authRuntime.openAuthWindow(); return { status: "ok" }; });
  ipcMain.handle("renmi:logout", (event) => allowed(event) && authRuntime ? authRuntime.logout() : { status: "error", message: "untrusted-settings-sender" });
  ipcMain.handle("renmi:check-for-updates", (event) => {
    if (!allowed(event) || !updater) return { status: "error", message: "updater unavailable" };
    return updater.checkForUpdates(true);
  });
}

async function start() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return;
  }
  app.on("second-instance", () => {
    if (authRuntime && !authRuntime.getSession()) authRuntime.openAuthWindow();
    else if (isLiveWindow(win)) win.showInactive();
  });
  await app.whenReady();
  if (isMac && app.dock && settingsController.get("showDock") === false) app.dock.hide();
  else if (isMac && app.dock) app.dock.show();
  settingsController.hydrate({ lang: renmiPrefs.mapLocaleToLang(app.getLocale()), openAtLogin: readOpenAtLogin() });
  createPetWindows();
  createTray();
  registerPetIpc();
  registerSettingsIpc();
  tickRuntime.startMainTick();
  if (settingsController.get("freeRoam") === true) roamRuntime.tick();
  studyBroadcastTimer = setInterval(() => {
    const snapshot = studyRuntime.getSnapshot();
    studyWindowRuntime.broadcastStudySnapshot(snapshot);
    const pomodoro = snapshot.pomodoro;
    if (pomodoro) sendToRenderer("timer-tick", pomodoro);
  }, 250);
  studyBroadcastTimer.unref?.();
  profileAutosaveTimer = setInterval(() => void pullAccountProfileIfNeeded(), 5000);
  profileAutosaveTimer.unref?.();
  try {
    authRuntime = createAuthRuntime({
      app,
      BrowserWindow,
      ipcMain,
      safeStorage,
      userDataDir: app.getPath("userData"),
      getMainWindows: () => [win, hitWin],
      setMainWindowsVisible,
      onAuthenticated: async (user) => {
        await hydrateAccountProfileForUser(user);
        rebuildMenus();
      },
      onBeforeLoggedOut: deactivateAccountProfile,
      onLoggedOut: rebuildMenus,
    });
    void authRuntime.start().catch((error) => console.warn("Renmi auth startup failed:", error && error.message));
  } catch (error) {
    console.warn("Renmi auth runtime unavailable:", error && error.message);
  }
  updater?.setupAutoUpdater();
  updater?.startUpdateScheduler();
  globalShortcut.register(settingsController.get("shortcuts").togglePet, togglePetVisibility);
  registeredShortcuts.set("togglePet", settingsController.get("shortcuts").togglePet);
}

app.on("before-quit", (event) => {
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    void Promise.resolve(saveAccountProfile({ force: true })).finally(() => app.quit());
    return;
  }
  updater?.stopUpdateScheduler();
  if (profileAutosaveTimer) clearInterval(profileAutosaveTimer);
  if (studyBroadcastTimer) clearInterval(studyBroadcastTimer);
  ambientRuntime?.close();
  studyRuntime?.dispose();
  studyIpcRuntime?.dispose();
  studyWindowRuntime?.close();
  authRuntime?.dispose();
  themeRuntime?.cleanup();
  tickRuntime?.cleanup();
  miniRuntime?.cleanup();
  roamRuntime?.cancelRoam();
  globalShortcut.unregisterAll();
  settingsController.persist();
  destroyTray();
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

void start().catch((error) => {
  console.error("Renmi startup failed:", error && error.stack ? error.stack : error);
  app.quit();
});

module.exports = {
  availableThemes,
  buildCurrentAccountProfile,
  getStudyI18n,
};
