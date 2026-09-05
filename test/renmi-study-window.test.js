"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const Module = require("node:module");

const createdWindows = [];
const fakeNativeTheme = { shouldUseDarkColors: false, on() {} };

class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.bounds = {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    };
    this.listeners = new Map();
    this.webContents = {
      isDestroyed: () => false,
      once: (event, callback) => this.listeners.set(`webContents:${event}`, callback),
      send: () => {},
    };
    createdWindows.push(this);
  }

  isDestroyed() { return false; }
  isMinimized() { return false; }
  isMaximized() { return false; }
  isFullScreen() { return false; }
  setMenuBarVisibility() {}
  loadFile() {}
  once(event, callback) { this.listeners.set(event, callback); }
  on(event, callback) { this.listeners.set(event, callback); }
  show() {}
  focus() {}
  getBounds() { return { ...this.bounds }; }
  setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; }
  setBackgroundColor() {}
  setTitle() {}
}

const originalLoad = Module._load;
Module._load = function loadRenmiStudyWindow(request, parent, isMain) {
  if (request === "electron") {
    return { BrowserWindow: FakeBrowserWindow, nativeTheme: fakeNativeTheme };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const createStudyWindowRuntime = require("../src/study-window");
Module._load = originalLoad;

function createHarness() {
  let follow = false;
  const pet = { x: 100, y: 200, width: 100, height: 100 };
  const runtime = createStudyWindowRuntime({
    shouldFollowPet: () => follow,
    getPetWindowBounds: () => pet,
    getNearestWorkArea: () => ({ x: 0, y: 0, width: 1200, height: 900 }),
    getTextScale: () => 1,
  });
  return {
    runtime,
    pet,
    setFollow(value) { follow = value; },
  };
}

describe("Renmi Study panel pet tracking", () => {
  it("anchors to the pet, changes sides at an edge, and can be disabled", () => {
    createdWindows.length = 0;
    const harness = createHarness();
    const window = harness.runtime.showStudyDashboard();

    assert.equal(window.getBounds().x, 220, "disabled follow starts centered");

    harness.setFollow(true);
    assert.equal(harness.runtime.repositionNearPet({ follow: true }), true);
    assert.deepEqual(window.getBounds(), { x: 224, y: 0, width: 760, height: 820 });

    harness.pet.x = 900;
    harness.runtime.repositionNearPet({ follow: true });
    assert.equal(window.getBounds().x, 116, "the panel moves to the pet's left side");

    const before = window.getBounds();
    harness.setFollow(false);
    assert.equal(harness.runtime.repositionNearPet({ follow: false }), false);
    assert.deepEqual(window.getBounds(), before, "disabled follow preserves the user's panel position");
  });
});
