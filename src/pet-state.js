"use strict";

// Small visual state machine for the Renmi product. Study focus is the only
// external activity that drives non-idle pet states.

function firstFile(theme, state) {
  if (!theme || typeof theme !== "object") return null;
  const miniStates = theme.miniMode && theme.miniMode.states;
  const entry = miniStates && miniStates[state] || theme.states && theme.states[state];
  if (Array.isArray(entry)) return entry[0] || null;
  if (entry && typeof entry === "object" && Array.isArray(entry.files)) return entry.files[0] || null;
  return theme.states && Array.isArray(theme.states.idle) ? theme.states.idle[0] : null;
}

function resolveHitBox(theme, state, svg) {
  if (!theme || !theme.hitBoxes) return null;
  const wideFiles = Array.isArray(theme.wideHitboxFiles) ? theme.wideHitboxFiles : [];
  const sleepingFiles = Array.isArray(theme.sleepingHitboxFiles) ? theme.sleepingHitboxFiles : [];
  if (sleepingFiles.includes(svg) && theme.hitBoxes.sleeping) return theme.hitBoxes.sleeping;
  if (wideFiles.includes(svg) && theme.hitBoxes.wide) return theme.hitBoxes.wide;
  if (["sleeping", "dozing", "yawning", "collapsing", "mini-sleep"].includes(state) && theme.hitBoxes.sleeping) {
    return theme.hitBoxes.sleeping;
  }
  return theme.hitBoxes.default || theme.hitBoxes.wide || null;
}

function createPetState(options = {}) {
  const getTheme = typeof options.getTheme === "function" ? options.getTheme : () => null;
  const sendToRenderer = typeof options.sendToRenderer === "function" ? options.sendToRenderer : () => {};
  const onStateChanged = typeof options.onStateChanged === "function" ? options.onStateChanged : () => {};
  let state = "idle";
  let svg = null;
  let autoReturnTimer = null;

  function clearAutoReturn() {
    if (autoReturnTimer) clearTimeout(autoReturnTimer);
    autoReturnTimer = null;
  }

  function scheduleAutoReturn(nextState) {
    const theme = getTheme();
    const delay = theme && theme.timings && theme.timings.autoReturn
      && Number(theme.timings.autoReturn[nextState]);
    if (!Number.isFinite(delay) || delay <= 0) return;
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      if (state === nextState) applyState("idle");
    }, delay);
    autoReturnTimer.unref?.();
  }

  function refreshTheme() {
    const theme = getTheme();
    svg = firstFile(theme, state) || firstFile(theme, "idle");
    return svg;
  }

  function applyState(nextState, svgOverride) {
    const next = typeof nextState === "string" && nextState ? nextState : "idle";
    const theme = getTheme();
    clearAutoReturn();
    state = next;
    svg = typeof svgOverride === "string" && svgOverride
      ? svgOverride
      : firstFile(theme, next);
    if (!svg) {
      state = "idle";
      svg = firstFile(theme, "idle");
    }
    try { sendToRenderer("state-change", state, svg); } catch {}
    try { onStateChanged(state); } catch {}
    if (state !== "idle" && state !== "sleeping" && state !== "dozing") {
      scheduleAutoReturn(state);
    }
    return { state, svg };
  }

  function cleanup() {
    clearAutoReturn();
    state = "idle";
    svg = null;
  }

  refreshTheme();
  return {
    applyState,
    setState: applyState,
    refreshTheme,
    cleanup,
    getCurrentState: () => state,
    getCurrentSvg: () => svg,
    getCurrentHitBox: () => resolveHitBox(getTheme(), state, svg),
  };
}

module.exports = { createPetState, firstFile, resolveHitBox };
