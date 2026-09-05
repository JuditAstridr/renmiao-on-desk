"use strict";

// Character configuration store.
//
// Persists the user's skin choices (selected skin, body color, size,
// accessories/patterns) to `<userData>/character-config.json` — the same
// self-contained JSON persistence style as study-runtime.js. The main process
// is the authority; renderer windows (pet + character select) read/save via
// IPC. This is the CommonJS equivalent of the spec's store/characterConfig.js
// (Pinia + localStorage in the Vue sketch).

const fs = require("fs");
const path = require("path");

const CONFIG_FILENAME = "character-config.json";
const SCHEMA_VERSION = 1;

const MIN_SIZE = 0.5;
const MAX_SIZE = 2.0;
const DEFAULT_COLOR = "#ffffff";

const DEFAULTS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  themeId: null,               // skin id (theme folder name); null until chosen
  color: DEFAULT_COLOR,
  size: 1.0,
  selectedAccessories: Object.freeze([]),
  selectedPatterns: Object.freeze([]),
  configured: false,           // flips true after the first confirm
});

let configPath = null;
let cache = null;

function init(userDataDir) {
  if (userDataDir) {
    configPath = path.join(userDataDir, CONFIG_FILENAME);
  }
  cache = null;
}

function cloneDefaults() {
  return {
    ...DEFAULTS,
    selectedAccessories: [],
    selectedPatterns: [],
  };
}

function isValidHexColor(value) {
  return typeof value === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/.test(value);
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === "string" && item && !out.includes(item)) out.push(item);
  }
  return out;
}

/**
 * Coerce untrusted JSON (disk or IPC payload) into a valid config. Unknown
 * fields are dropped; out-of-range values are clamped or defaulted.
 */
function normalize(raw) {
  const cfg = cloneDefaults();
  if (!raw || typeof raw !== "object") return cfg;

  if (typeof raw.themeId === "string" && raw.themeId) cfg.themeId = raw.themeId;
  if (isValidHexColor(raw.color)) cfg.color = raw.color;

  const size = Number(raw.size);
  if (Number.isFinite(size)) cfg.size = Math.min(MAX_SIZE, Math.max(MIN_SIZE, size));

  cfg.selectedAccessories = normalizeIdList(raw.selectedAccessories);
  cfg.selectedPatterns = normalizeIdList(raw.selectedPatterns);
  cfg.configured = raw.configured === true;
  return cfg;
}

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    if (configPath && fs.existsSync(configPath)) {
      raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err) {
    console.warn("[character-config] unreadable config, falling back to defaults:", err && err.message);
    raw = null;
  }
  cache = normalize(raw);
  return cache;
}

function getConfig() {
  return { ...load(), selectedAccessories: [...load().selectedAccessories], selectedPatterns: [...load().selectedPatterns] };
}

function isConfigured() {
  return load().configured === true;
}

/**
 * Validate + merge a patch (from the select page) and persist atomically.
 * Returns the saved config.
 */
function saveConfig(patch) {
  const safePatch = patch && typeof patch === "object" ? { ...patch } : {};
  // Saving from the selector is the explicit first-run confirmation. Keep
  // this transition in the main-process store so renderer callers cannot
  // accidentally leave the app in an unconfigured state.
  if (typeof safePatch.themeId === "string" && safePatch.themeId) {
    safePatch.configured = true;
  }
  const next = normalize({ ...load(), ...safePatch });
  try {
    if (configPath) {
      const tmp = `${configPath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2), "utf8");
      fs.renameSync(tmp, configPath);
    }
  } catch (err) {
    console.warn("[character-config] failed to persist config:", err && err.message);
  }
  cache = next;
  return getConfig();
}

/**
 * Resolve the full payload handed to renderer windows: the active skin
 * descriptor (resolved through character-loader) plus the saved config.
 * Falls back to the first available skin when the saved id is missing so the
 * pet is always renderable.
 *
 * @param {object} characterLoader - the initialized character-loader module
 */
function resolvePayload(characterLoader) {
  const config = getConfig();
  let skins = [];
  try {
    skins = characterLoader.discoverSkins();
  } catch (err) {
    console.warn("[character-config] skin discovery failed:", err && err.message);
  }

  let skin = (config.themeId && skins.find((s) => s.id === config.themeId)) || null;
  if (!skin && skins.length > 0) {
    skin = skins[0];
  }
  // Skin mode only takes over the pet after the user has confirmed a choice
  // once; an unconfigured install keeps the default clawd theme.
  if (!skin || !config.configured) {
    return { active: false, config, skin: null, skins };
  }

  // The skin itself decides whether coloring is supported; keep the saved
  // color either way so toggling skins doesn't lose the choice.
  return {
    active: true,
    config: {
      ...config,
      themeId: skin.id,
      isColoringSkin: skin.isColoringSkin,
    },
    skin,
    skins,
  };
}

module.exports = {
  init,
  load,
  getConfig,
  saveConfig,
  isConfigured,
  resolvePayload,
  normalize,
  isValidHexColor,
  MIN_SIZE,
  MAX_SIZE,
  DEFAULT_COLOR,
  CONFIG_FILENAME,
};
