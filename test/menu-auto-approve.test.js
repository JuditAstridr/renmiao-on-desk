"use strict";

const assert = require("node:assert");
const Module = require("node:module");
const { describe, it } = require("node:test");

const MENU_MODULE_PATH = require.resolve("../src/menu");

function loadMenuWithElectron(fakeElectron) {
  delete require.cache[MENU_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/menu");
  } finally {
    Module._load = originalLoad;
  }
}

function fakeElectron() {
  return {
    app: { quit() {}, setActivationPolicy() {}, dock: { show() {}, hide() {} } },
    BrowserWindow: function BrowserWindow() {},
    Menu: { buildFromTemplate(template) { return { template }; } },
    Tray: function Tray() {},
    nativeImage: { createFromPath() { return { resize() { return this; }, setTemplateImage() {} }; } },
    screen: {
      getAllDisplays: () => [{
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
      }],
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
      getDisplayNearestPoint: () => ({ id: 1 }),
    },
  };
}

function makeContext(overrides = {}) {
  return {
    win: { isDestroyed: () => false },
    currentSize: "P:15",
    lang: "en",
    showTray: true,
    showDock: true,
    openAtLogin: false,
    hideBubbles: false,
    soundMuted: false,
    petHidden: false,
    menuOpen: false,
    tray: null,
    contextMenuOwner: null,
    getMiniMode: () => false,
    getMiniTransitioning: () => false,
    getDisableMiniMode: () => false,
    getActiveThemeCapabilities: () => ({ miniMode: true }),
    openSettingsWindow() {},
    togglePetVisibility() {},
    bringPetToPrimaryDisplay() {},
    enterMiniViaMenu() {},
    exitMiniMode() {},
    miniHandleResize: () => false,
    getPetWindowBounds: () => ({ x: 10, y: 20, width: 120, height: 120 }),
    getCurrentPixelSize: () => ({ width: 200, height: 200 }),
    isProportionalMode: () => true,
    repositionBubbles() {},
    syncHitWin() {},
    flushRuntimeStateToPrefs() {},
    reapplyMacVisibility() {},
    clampToScreenVisual: (x, y) => ({ x, y }),
    ...overrides,
  };
}

function assertMenuDoesNotExposePermissionHandling(template) {
  const labels = template.map((item) => item && item.label).filter(Boolean);
  assert.ok(!labels.some((label) => label.startsWith("Permission handling:")));
}

describe("permission automation menu", () => {
  it("is removed from the context menu without changing settings handlers", () => {
    const menu = loadMenuWithElectron(fakeElectron());
    const ctx = makeContext({
      permissionAutomationMode: "unattended",
      setPermissionAutomationMode() {
        throw new Error("the menu must not call settings handlers");
      },
    });
    const runtime = menu(ctx);
    runtime.buildContextMenu();
    assertMenuDoesNotExposePermissionHandling(ctx.contextMenu.template);
  });

  it("is removed from the tray menu without changing settings handlers", () => {
    const menu = loadMenuWithElectron(fakeElectron());
    let trayTemplate = null;
    const ctx = makeContext({
      tray: { setContextMenu: (value) => { trayTemplate = value.template; } },
      permissionAutomationMode: "auto-tools",
      setPermissionAutomationMode() {
        throw new Error("the menu must not call settings handlers");
      },
    });
    const runtime = menu(ctx);
    runtime.buildTrayMenu();
    assert.ok(Array.isArray(trayTemplate));
    assertMenuDoesNotExposePermissionHandling(trayTemplate);
  });
});
