"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createAmbientRuntime } = require("../src/ambient-runtime");

function loadDucking() {
  const context = { globalThis: null, setTimeout, clearTimeout, console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "ambient-ducking.js"), "utf8"),
    context
  );
  return context.ClawdAmbientDucking;
}

function makePrefs(overrides = {}) {
  return {
    ambientEnabled: true,
    ambientMasterVolume: 0.6,
    ambientLayers: { brown: 0.3, rain: 0.5 },
    ambientStateBinding: { working: ["brown"], idle: ["rain"], sleep: ["brown"] },
    ambientDuckingMs: 500,
    ambientDuckCooldownMs: 2000,
    ambientUserPresets: [],
    ambientAutoStateBinding: true,
    soundMuted: false,
    ...overrides,
  };
}

describe("ambient runtime coordinator", () => {
  it("broadcasts an ambient snapshot only when preferences or gates change", () => {
    let prefs = makePrefs({ ambientEnabled: false });
    const messages = [];
    const runtime = createAmbientRuntime();
    runtime.init({
      getPrefs: () => prefs,
      getDoNotDisturb: () => false,
      sendToRenderer: (...args) => messages.push(args),
    });

    runtime.onPrefsUpdate(prefs);
    assert.equal(messages.length, 0);

    prefs = makePrefs();
    runtime.onPrefsUpdate(prefs);
    assert.equal(messages.length, 1);
    assert.equal(messages[0][0], "ambient-prefs-update");
    assert.equal(messages[0][1].ambient.ambientEnabled, true);

    prefs.ambientMasterVolume = 0.1;
    runtime.onPrefsUpdate(prefs);
    assert.equal(messages.length, 2);
  });

  it("relays state changes only while the ambient gate is open", () => {
    const prefs = makePrefs();
    const messages = [];
    const runtime = createAmbientRuntime();
    runtime.init({
      getPrefs: () => prefs,
      getDoNotDisturb: () => false,
      sendToRenderer: (...args) => messages.push(args),
    });

    runtime.onStateChanged("thinking");
    assert.equal(messages.length, 1);
    assert.equal(messages[0][0], "ambient-state-change");
    assert.equal(messages[0][1].state, "thinking");

    prefs.soundMuted = true;
    runtime.onStateChanged("idle");
    assert.equal(messages.length, 2);
    assert.equal(messages[1][0], "ambient-prefs-update");
  });

  it("rebroadcasts runtime-only DND gate changes", () => {
    let dnd = false;
    const messages = [];
    const runtime = createAmbientRuntime();
    runtime.init({
      getPrefs: () => makePrefs(),
      getDoNotDisturb: () => dnd,
      sendToRenderer: (...args) => messages.push(args),
    });

    dnd = true;
    runtime.onGatesChanged();
    assert.equal(messages.length, 1);
    assert.equal(messages[0][0], "ambient-prefs-update");
    assert.equal(messages[0][1].gates.doNotDisturb, true);

    runtime.close();
    dnd = false;
    runtime.onGatesChanged();
    assert.equal(messages.length, 1);
  });

  it("restores the latest user volume after a preference update during ducking", async () => {
    const Ducking = loadDucking();
    const calls = [];
    const masterGain = {
      gain: {
        value: 0.6,
        cancelScheduledValues() {},
        setValueAtTime(value) { this.value = value; calls.push(value); },
        linearRampToValueAtTime(value) { this.value = value; },
      },
    };
    const duck = Ducking.createDuckCoordinator({
      ctx: { currentTime: 0 },
      masterGain,
      duckingMs: 0,
      cooldownMs: 0,
    });

    duck.onStateSoundTriggered();
    duck.setRestoreLevels({ master: 0.25 });
    duck.onStateSoundEnded();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(masterGain.gain.value, 0.25);
    assert.ok(calls.includes(0));
  });
});
