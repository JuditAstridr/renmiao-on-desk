"use strict";

// Coordinates state sound effects with the ambient bus and optional music.
// State sounds remain owned by the existing sound path; this module only
// ramps the two ambient outputs down and restores their previous levels.
(function installAmbientDucking(root) {
  function clamp01(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  }

  function createDuckCoordinator(options = {}) {
    const context = options.ctx || null;
    const masterGain = options.masterGain || null;
    const music = options.musicController || null;
    let duckingMs = Number.isFinite(options.duckingMs) ? Math.max(0, options.duckingMs) : 500;
    let cooldownMs = Number.isFinite(options.cooldownMs) ? Math.max(0, options.cooldownMs) : 2000;
    let active = false;
    let restoreTimer = null;
    let savedMaster = null;
    let savedMusic = null;

    function clearRestoreTimer() {
      if (restoreTimer) { clearTimeout(restoreTimer); restoreTimer = null; }
    }

    function rampMaster(value, duration) {
      if (!context || !masterGain) return;
      try {
        const now = context.currentTime;
        const target = clamp01(value);
        masterGain.gain.cancelScheduledValues(now);
        masterGain.gain.setValueAtTime(masterGain.gain.value, now);
        if (duration > 0) masterGain.gain.linearRampToValueAtTime(target, now + duration / 1000);
        else masterGain.gain.setValueAtTime(target, now);
      } catch {}
    }

    function rampMusic(value, duration) {
      if (!music || typeof music.setVolume !== "function") return;
      try { music.setVolume(clamp01(value), duration); } catch {}
    }

    function onStateSoundTriggered() {
      clearRestoreTimer();
      if (active) return;
      active = true;
      savedMaster = masterGain && masterGain.gain ? clamp01(masterGain.gain.value) : 0;
      savedMusic = music && typeof music.getTargetVolume === "function"
        ? clamp01(music.getTargetVolume())
        : 0;
      rampMaster(0, duckingMs);
      rampMusic(0, duckingMs);
    }

    function recover() {
      active = false;
      rampMaster(savedMaster == null ? 0 : savedMaster, duckingMs);
      rampMusic(savedMusic == null ? 0 : savedMusic, duckingMs);
      savedMaster = null; savedMusic = null;
    }

    function onStateSoundEnded() {
      if (!active) return;
      clearRestoreTimer();
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        recover();
      }, Math.max(0, cooldownMs | 0));
    }

    function setRestoreLevels(levels = {}) {
      if (!active || !levels || typeof levels !== "object") return;
      if (typeof levels.master === "number" && Number.isFinite(levels.master)) {
        savedMaster = clamp01(levels.master);
      }
      if (typeof levels.music === "number" && Number.isFinite(levels.music)) {
        savedMusic = clamp01(levels.music);
      }
      // A preference update applies the user's new target immediately. Keep
      // the output ducked until the state sound cooldown expires, then restore
      // the newly selected levels instead of stale pre-duck values.
      rampMaster(0, 0);
      rampMusic(0, 0);
    }

    return {
      onStateSoundTriggered,
      onStateSoundEnded,
      setRestoreLevels,
      setDuckingMs: (value) => { if (Number.isFinite(value) && value >= 0) duckingMs = value; },
      setCooldownMs: (value) => { if (Number.isFinite(value) && value >= 0) cooldownMs = value; },
      isActive: () => active,
      dispose() { clearRestoreTimer(); active = false; savedMaster = null; savedMusic = null; },
    };
  }

  root.ClawdAmbientDucking = { createDuckCoordinator };
})(globalThis);
