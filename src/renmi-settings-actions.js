"use strict";

// Settings actions for the standalone Renmi runtime.  No agent, hook,
// permission, quota, dashboard, or remote-transport action is registered here.

const {
  parseAccelerator,
  isDangerousAccelerator,
  getDefaultShortcuts,
} = require("./renmi-shortcut-actions");

function ok() { return { status: "ok" }; }
function error(message) { return { status: "error", message }; }
function isRecord(value) { return !!value && typeof value === "object" && !Array.isArray(value); }
function booleanValue(key) { return (value) => typeof value === "boolean" ? ok() : error(`${key} must be boolean`); }
function finiteValue(key, min = -Infinity, max = Infinity) {
  return (value) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? ok()
    : error(`${key} must be a finite number in range`);
}
function mapValue(key) {
  return (value) => isRecord(value) ? ok() : error(`${key} must be an object`);
}

const updateRegistry = {
  x: finiteValue("x"),
  y: finiteValue("y"),
  positionSaved: booleanValue("positionSaved"),
  positionThemeId: (value) => typeof value === "string" ? ok() : error("positionThemeId must be a string"),
  positionVariantId: (value) => typeof value === "string" ? ok() : error("positionVariantId must be a string"),
  positionDisplay: (value) => value === null || isRecord(value) ? ok() : error("positionDisplay must be an object or null"),
  size: (value) => typeof value === "string" && (/^P:\d+(?:\.\d+)?$/.test(value) || ["S", "M", "L"].includes(value))
    ? ok() : error("invalid pet size"),
  miniMode: booleanValue("miniMode"),
  miniEdge: (value) => value === "left" || value === "right" ? ok() : error("miniEdge must be left or right"),
  preMiniX: finiteValue("preMiniX"),
  preMiniY: finiteValue("preMiniY"),
  lang: (value) => ["en", "zh", "zh-TW", "ko", "ja", "pt-BR", "es"].includes(value)
    ? ok() : error("unsupported language"),
  showTray: booleanValue("showTray"),
  showDock: booleanValue("showDock"),
  openAtLogin: booleanValue("openAtLogin"),
  soundMuted: booleanValue("soundMuted"),
  soundVolume: finiteValue("soundVolume", 0, 1),
  ambientEnabled: booleanValue("ambientEnabled"),
  ambientMasterVolume: finiteValue("ambientMasterVolume", 0, 1),
  ambientLayers: mapValue("ambientLayers"),
  ambientStateBinding: mapValue("ambientStateBinding"),
  ambientDuckingMs: finiteValue("ambientDuckingMs", 100, 3000),
  ambientDuckCooldownMs: finiteValue("ambientDuckCooldownMs", 500, 10000),
  ambientUserPresets: (value) => Array.isArray(value) ? ok() : error("ambientUserPresets must be an array"),
  ambientAutoStateBinding: booleanValue("ambientAutoStateBinding"),
  allowEdgePinning: booleanValue("allowEdgePinning"),
  disableMiniMode: booleanValue("disableMiniMode"),
  keepSizeAcrossDisplays: booleanValue("keepSizeAcrossDisplays"),
  textScale: finiteValue("textScale", 0.8, 1.5),
  textScaleByDisplay: mapValue("textScaleByDisplay"),
  shortcuts: mapValue("shortcuts"),
  theme: (value) => typeof value === "string" && value.length > 0 ? ok() : error("theme must be a string"),
  themeVariant: mapValue("themeVariant"),
  themeOverrides: mapValue("themeOverrides"),
  idleVisual: mapValue("idleVisual"),
  petTint: mapValue("petTint"),
  petTintSaturation: mapValue("petTintSaturation"),
  petAccessory: mapValue("petAccessory"),
  holidayAccessoryEnabled: mapValue("holidayAccessoryEnabled"),
  lowPowerIdleMode: booleanValue("lowPowerIdleMode"),
  freeRoam: booleanValue("freeRoam"),
  roamConstrainAxis: booleanValue("roamConstrainAxis"),
  studyFollowPet: booleanValue("studyFollowPet"),
};

for (const key of [
  "soundMuted", "soundVolume", "ambientEnabled", "ambientMasterVolume", "ambientLayers",
  "ambientStateBinding", "ambientDuckingMs", "ambientDuckCooldownMs", "ambientUserPresets",
  "ambientAutoStateBinding",
]) {
  const base = updateRegistry[key];
  updateRegistry[key] = {
    validate: base,
    effect: (_value, deps) => typeof deps.syncAmbient === "function" ? deps.syncAmbient() : ok(),
  };
}
updateRegistry.soundMuted = {
  validate: booleanValue("soundMuted"),
  effect: (_value, deps) => typeof deps.syncSound === "function" ? deps.syncSound() : ok(),
};
updateRegistry.soundVolume = {
  validate: finiteValue("soundVolume", 0, 1),
  effect: (_value, deps) => typeof deps.syncSound === "function" ? deps.syncSound() : ok(),
};
updateRegistry.openAtLogin = {
  validate: booleanValue("openAtLogin"),
  effect: (value, deps) => typeof deps.setOpenAtLogin === "function" ? deps.setOpenAtLogin(value) || ok() : ok(),
};
updateRegistry.size = {
  validate: updateRegistry.size,
  effect: (value, deps) => typeof deps.applySize === "function" ? deps.applySize(value) || ok() : ok(),
};
for (const key of ["petTint", "petTintSaturation", "petAccessory", "holidayAccessoryEnabled", "idleVisual"]) {
  updateRegistry[key] = {
    validate: updateRegistry[key],
    effect: (_value, deps) => typeof deps.syncPetCustomization === "function" ? deps.syncPetCustomization() : ok(),
  };
}
updateRegistry.lang = {
  validate: updateRegistry.lang,
  effect: (_value, deps) => typeof deps.syncLanguage === "function" ? deps.syncLanguage() : ok(),
};
for (const key of ["freeRoam", "roamConstrainAxis"]) {
  updateRegistry[key] = {
    validate: updateRegistry[key],
    effect: (_value, deps) => typeof deps.syncRoam === "function" ? deps.syncRoam() : ok(),
  };
}
updateRegistry.studyFollowPet = {
  validate: booleanValue("studyFollowPet"),
  effect: (value, deps) => typeof deps.syncStudyPanelTracking === "function"
    ? deps.syncStudyPanelTracking(value)
    : ok(),
};

function resolveThemeId(payload) {
  return typeof payload === "string" ? payload : payload && payload.themeId;
}

async function setThemeSelection(payload, deps) {
  const themeId = resolveThemeId(payload);
  if (typeof themeId !== "string" || !themeId) return error("theme id is required");
  if (typeof deps.isThemeAvailable === "function" && !deps.isThemeAvailable(themeId)) {
    return error("theme is unavailable");
  }
  const current = deps.snapshot || {};
  const variantId = typeof payload?.variantId === "string" && payload.variantId
    ? payload.variantId
    : ((current.themeVariant && current.themeVariant[themeId]) || "default");
  if (typeof deps.activateTheme === "function") {
    const activated = await deps.activateTheme(themeId, variantId);
    if (!activated || activated.status === "error") return activated || error("theme activation failed");
  }
  return {
    status: "ok",
    commit: {
      theme: themeId,
      themeVariant: { ...(current.themeVariant || {}), [themeId]: variantId },
    },
  };
}

async function setIdleVisual(payload, deps) {
  if (!isRecord(payload)) return error("idle visual payload must be an object");
  const { themeId, file } = payload;
  if (typeof themeId !== "string" || !themeId || (file !== "" && typeof file !== "string")) {
    return error("invalid idle visual payload");
  }
  if (typeof deps.isIdleVisualAllowed === "function" && !deps.isIdleVisualAllowed(themeId, file)) {
    return error("idle visual is unavailable");
  }
  const next = { ...((deps.snapshot && deps.snapshot.idleVisual) || {}) };
  if (file) next[themeId] = file;
  else delete next[themeId];
  return { status: "ok", commit: { idleVisual: next } };
}

function registerShortcut(payload, deps) {
  if (!isRecord(payload) || payload.actionId !== "togglePet") return error("unknown shortcut action");
  const accelerator = payload.accelerator === null ? null : payload.accelerator;
  if (accelerator !== null && (typeof accelerator !== "string" || !parseAccelerator(accelerator))) {
    return error("invalid accelerator format");
  }
  const normalized = accelerator === null ? null : parseAccelerator(accelerator).accelerator;
  if (normalized && isDangerousAccelerator(normalized)) return error("reserved accelerator");
  const current = (deps.snapshot && deps.snapshot.shortcuts) || getDefaultShortcuts();
  if (normalized && typeof deps.registerShortcut === "function") {
    const result = deps.registerShortcut(current.togglePet || null, normalized);
    if (!result || result.status !== "ok") return result || error("shortcut registration failed");
  } else if (!normalized && current.togglePet && typeof deps.unregisterShortcut === "function") {
    const result = deps.unregisterShortcut(current.togglePet);
    if (!result || result.status !== "ok") return result || error("shortcut removal failed");
  }
  return { status: "ok", commit: { shortcuts: { togglePet: normalized } } };
}

function resetShortcut(_payload, deps) {
  return registerShortcut({ actionId: "togglePet", accelerator: getDefaultShortcuts().togglePet }, deps);
}

function resetAllShortcuts(_payload, deps) {
  return registerShortcut({ actionId: "togglePet", accelerator: getDefaultShortcuts().togglePet }, deps);
}

const commandRegistry = {
  setThemeSelection,
  setIdleVisual,
  registerShortcut,
  resetShortcut,
  resetAllShortcuts,
  hidePet: async (_payload, deps) => {
    if (typeof deps.hidePet !== "function") return error("pet window is unavailable");
    const result = await deps.hidePet();
    return result && result.status === "error" ? result : ok();
  },
};

module.exports = { updateRegistry, commandRegistry };
