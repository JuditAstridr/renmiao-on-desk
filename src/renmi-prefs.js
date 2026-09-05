"use strict";

// Renmi's preference boundary.  This intentionally has no dependency on the
// historical Clawd prefs schema: loading a Renmi process must not import
// agent registries, hook/permission settings, quota, or remote transports.

const fs = require("node:fs");
const path = require("node:path");
const { getDefaultShortcuts } = require("./renmi-shortcut-actions");

const CURRENT_VERSION = 1;
const AMBIENT_LAYERS = Object.freeze([
  "white", "pink", "brown", "rain", "fire", "waves", "cafe", "keyboard",
]);
const LANGS = Object.freeze(["en", "zh", "zh-TW", "ko", "ja", "pt-BR", "es"]);

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finite(value, fallback, min = -Infinity, max = Infinity) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function normalizeMap(value, valueGuard) {
  if (!isRecord(value)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || !key || typeof valueGuard !== "function" || !valueGuard(entry)) continue;
    out[key] = entry;
  }
  return out;
}

function normalizeLayers(value) {
  const defaults = {
    white: 0, pink: 0, brown: 0.3, rain: 0.5,
    fire: 0, waves: 0, cafe: 0, keyboard: 0,
  };
  if (!isRecord(value)) return defaults;
  return Object.fromEntries(AMBIENT_LAYERS.map((name) => [
    name,
    finite(value[name], 0, 0, 1),
  ]));
}

function normalizeBinding(value) {
  const defaults = { working: ["brown", "rain"], idle: ["white"], sleep: ["brown"] };
  if (!isRecord(value)) return defaults;
  const allowed = new Set(AMBIENT_LAYERS);
  return Object.fromEntries(Object.entries(defaults).map(([state, fallback]) => {
    const entries = Array.isArray(value[state]) ? value[state] : fallback;
    return [state, [...new Set(entries.filter((name) => allowed.has(name)))]];
  }));
}

function normalizePresets(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string" || !entry.name.trim()) return [];
    return [{
      name: entry.name.trim().slice(0, 64),
      layers: normalizeLayers(entry.layers),
      master: finite(entry.master, 0.6, 0, 1),
    }];
  }).slice(0, 32);
}

function normalizeShortcuts(value) {
  const defaults = getDefaultShortcuts();
  if (!isRecord(value)) return defaults;
  return {
    togglePet: typeof value.togglePet === "string" ? value.togglePet : defaults.togglePet,
  };
}

function normalizeSize(value) {
  if (value === "S" || value === "M" || value === "L") return value;
  return typeof value === "string" && /^P:\d+(?:\.\d+)?$/.test(value) ? value : "P:9";
}

function normalizeThemeOverrides(value) {
  return isRecord(value) ? clone(value) : {};
}

function getDefaults() {
  return {
    version: CURRENT_VERSION,
    x: 0,
    y: 0,
    positionSaved: false,
    positionThemeId: "",
    positionVariantId: "",
    positionDisplay: null,
    size: "P:9",
    miniMode: false,
    miniEdge: "right",
    preMiniX: 0,
    preMiniY: 0,
    lang: "en",
    showTray: true,
    showDock: false,
    openAtLogin: false,
    soundMuted: false,
    soundVolume: 1,
    ambientEnabled: false,
    ambientMasterVolume: 0.6,
    ambientLayers: normalizeLayers(null),
    ambientStateBinding: normalizeBinding(null),
    ambientDuckingMs: 500,
    ambientDuckCooldownMs: 2000,
    ambientUserPresets: [],
    ambientAutoStateBinding: false,
    allowEdgePinning: false,
    disableMiniMode: false,
    keepSizeAcrossDisplays: false,
    textScale: 1,
    textScaleByDisplay: {},
    shortcuts: getDefaultShortcuts(),
    theme: "renmi",
    themeVariant: {},
    themeOverrides: {},
    idleVisual: {},
    petTint: {},
    petTintSaturation: {},
    petAccessory: {},
    holidayAccessoryEnabled: {},
    lowPowerIdleMode: false,
    freeRoam: false,
    roamConstrainAxis: false,
    studyFollowPet: true,
  };
}

function validate(raw) {
  const source = isRecord(raw) ? raw : {};
  const out = getDefaults();
  out.x = finite(source.x, out.x);
  out.y = finite(source.y, out.y);
  out.positionSaved = source.positionSaved === true;
  out.positionThemeId = typeof source.positionThemeId === "string" ? source.positionThemeId.slice(0, 128) : "";
  out.positionVariantId = typeof source.positionVariantId === "string" ? source.positionVariantId.slice(0, 128) : "";
  out.positionDisplay = isRecord(source.positionDisplay) ? clone(source.positionDisplay) : null;
  out.size = normalizeSize(source.size);
  out.miniMode = source.miniMode === true;
  out.miniEdge = source.miniEdge === "left" ? "left" : "right";
  out.preMiniX = finite(source.preMiniX, 0);
  out.preMiniY = finite(source.preMiniY, 0);
  out.lang = LANGS.includes(source.lang) ? source.lang : "en";
  for (const key of ["showTray", "showDock", "openAtLogin", "soundMuted", "ambientEnabled", "ambientAutoStateBinding", "allowEdgePinning", "disableMiniMode", "keepSizeAcrossDisplays", "lowPowerIdleMode", "freeRoam", "roamConstrainAxis", "studyFollowPet"]) {
    // Preserve the schema default for settings introduced after an existing
    // prefs file was created. In particular, an older Renmi prefs file must
    // not silently turn the Study panel follow setting off just because the
    // key did not exist yet.
    out[key] = source[key] === undefined ? out[key] : source[key] === true;
  }
  out.soundVolume = finite(source.soundVolume, 1, 0, 1);
  out.ambientMasterVolume = finite(source.ambientMasterVolume, 0.6, 0, 1);
  out.ambientLayers = normalizeLayers(source.ambientLayers);
  out.ambientStateBinding = normalizeBinding(source.ambientStateBinding);
  out.ambientDuckingMs = Math.round(finite(source.ambientDuckingMs, 500, 100, 3000));
  out.ambientDuckCooldownMs = Math.round(finite(source.ambientDuckCooldownMs, 2000, 500, 10000));
  out.ambientUserPresets = normalizePresets(source.ambientUserPresets);
  out.textScale = finite(source.textScale, 1, 0.8, 1.5);
  out.textScaleByDisplay = normalizeMap(source.textScaleByDisplay, (value) => (
    typeof value === "number" && Number.isFinite(value) && value >= 0.8 && value <= 1.5
  ));
  out.shortcuts = normalizeShortcuts(source.shortcuts);
  out.theme = typeof source.theme === "string" && source.theme ? source.theme.slice(0, 128) : "renmi";
  out.themeVariant = normalizeMap(source.themeVariant, (value) => typeof value === "string" && value.length < 128);
  out.themeOverrides = normalizeThemeOverrides(source.themeOverrides);
  for (const key of ["idleVisual", "petTint", "petTintSaturation", "petAccessory"]) {
    out[key] = normalizeMap(source[key], (value) => typeof value === "string" && value.length < 256 || typeof value === "number" && Number.isFinite(value));
  }
  out.holidayAccessoryEnabled = normalizeMap(source.holidayAccessoryEnabled, (value) => value === true);
  return out;
}

function backupInvalidPrefs(prefsPath) {
  try {
    fs.copyFileSync(prefsPath, `${prefsPath}.bak`);
    return true;
  } catch {
    return false;
  }
}

function load(prefsPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
    return { snapshot: validate(raw), locked: false };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { snapshot: getDefaults(), locked: false, fresh: true };
    }
    const backedUp = backupInvalidPrefs(prefsPath);
    return { snapshot: getDefaults(), locked: !backedUp, recovered: true };
  }
}

function save(prefsPath, snapshot) {
  const normalized = validate(snapshot);
  fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
  fs.writeFileSync(prefsPath, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
}

function mapLocaleToLang(locale) {
  const value = String(locale || "").toLowerCase().replace(/_/g, "-");
  if (value.startsWith("zh")) return /hant|-(tw|hk|mo)/.test(value) ? "zh-TW" : "zh";
  if (value.startsWith("ko")) return "ko";
  if (value.startsWith("ja")) return "ja";
  if (value === "pt-br") return "pt-BR";
  if (value.startsWith("es")) return "es";
  return "en";
}

module.exports = {
  CURRENT_VERSION,
  AMBIENT_LAYERS,
  getDefaults,
  validate,
  load,
  save,
  mapLocaleToLang,
  normalizeLayers,
  normalizeBinding,
  normalizePresets,
  normalizeShortcuts,
};
