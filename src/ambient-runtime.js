"use strict";

// Main-process coordinator for ambient preferences. It never writes prefs;
// settings-controller remains the sole writer. It only sends a small,
// renderer-safe snapshot and relays the current pet state for auto binding.
const AMBIENT_KEYS = Object.freeze([
  "ambientEnabled", "ambientMasterVolume", "ambientLayers", "ambientStateBinding",
  "ambientDuckingMs", "ambientDuckCooldownMs", "ambientUserPresets",
  "ambientAutoStateBinding",
]);

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item);
    return out;
  }
  return value;
}

function sameValue(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
  }
  return false;
}

function createAmbientRuntime() {
  let deps = null;
  let ambient = null;
  let gates = null;
  let currentState = "idle";
  let closed = false;

  function getAmbientSlice(prefs) {
    if (!prefs || typeof prefs !== "object") return null;
    const out = {};
    for (const key of AMBIENT_KEYS) if (key in prefs) out[key] = cloneValue(prefs[key]);
    return out;
  }

  function getGates(prefs) {
    if (!prefs || typeof prefs !== "object") return null;
    return {
      soundMuted: prefs.soundMuted === true,
      // DND is runtime state in this app, not a persisted preference. Keep the
      // prefs fallback for small unit-test fakes and older embedders.
      doNotDisturb: typeof deps?.getDoNotDisturb === "function"
        ? deps.getDoNotDisturb() === true
        : prefs.doNotDisturb === true,
      soundVolume: typeof prefs.soundVolume === "number" ? prefs.soundVolume : 1,
    };
  }

  function refreshGates() {
    if (!deps || typeof deps.getPrefs !== "function") return false;
    const next = getGates(deps.getPrefs());
    if (sameValue(gates, next)) return false;
    gates = next;
    return true;
  }

  function canPlay() {
    return !!(ambient && ambient.ambientEnabled === true)
      && !(gates && (gates.soundMuted || gates.doNotDisturb));
  }

  function send(channel, payload) {
    if (!deps || typeof deps.sendToRenderer !== "function") return;
    try { deps.sendToRenderer(channel, payload); }
    catch (error) { try { console.warn("Renmi ambient broadcast failed", channel, error && error.message); } catch {} }
  }

  function init(options = {}) {
    deps = options;
    closed = false;
    const prefs = typeof deps.getPrefs === "function" ? deps.getPrefs() : null;
    ambient = getAmbientSlice(prefs);
    gates = getGates(prefs);
  }

  function onPrefsUpdate(prefs) {
    if (closed || !deps) return;
    const nextAmbient = getAmbientSlice(prefs);
    const nextGates = getGates(prefs);
    if (sameValue(ambient, nextAmbient) && sameValue(gates, nextGates)) return;
    ambient = nextAmbient;
    gates = nextGates;
    send("ambient-prefs-update", { ambient: cloneValue(ambient), gates: cloneValue(gates) });
  }

  // Send the current values even when they were already known at main-process
  // startup. This is required after the pet renderer loads or crashes/reloads.
  function syncToRenderer() {
    if (closed || !deps) return;
    refreshGates();
    send("ambient-prefs-update", { ambient: cloneValue(ambient), gates: cloneValue(gates) });
    if (canPlay()) {
      send("ambient-state-change", {
        state: currentState,
        ambient: cloneValue(ambient),
        gates: cloneValue(gates),
      });
    }
  }

  function onStateChanged(state) {
    if (closed || !deps) return;
    currentState = String(state || "idle");
    if (refreshGates()) {
      // DND transitions are runtime-only, so carry the new gate in the same
      // renderer-safe payload used for persisted preference changes.
      send("ambient-prefs-update", { ambient: cloneValue(ambient), gates: cloneValue(gates) });
    }
    if (!canPlay()) return;
    send("ambient-state-change", {
      state: currentState,
      ambient: cloneValue(ambient),
      gates: cloneValue(gates),
    });
  }

  function onStateSoundTriggered(soundName) {
    if (closed || !deps) return;
    refreshGates();
    if (!canPlay()) return;
    send("ambient-state-sound-trigger", { soundName: String(soundName || ""), ts: Date.now() });
  }

  function onGatesChanged() {
    if (closed || !deps) return;
    if (!refreshGates()) return;
    send("ambient-prefs-update", { ambient: cloneValue(ambient), gates: cloneValue(gates) });
  }

  function close() { closed = true; deps = null; ambient = null; gates = null; }

  return {
    init, onPrefsUpdate, syncToRenderer, onStateChanged, onStateSoundTriggered, onGatesChanged,
    getSnapshot: () => cloneValue(ambient),
    getGates: () => cloneValue(gates),
    isEnabled: () => !!(ambient && ambient.ambientEnabled === true),
    close,
  };
}

module.exports = { createAmbientRuntime, AMBIENT_KEYS };
