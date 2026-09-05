"use strict";

// Character (skin) loader for the study companion.
//
// This is the lightweight, data-driven skin system used by the character
// selection page and the pet window's "skin mode". It is intentionally
// separate from the heavy SVG-animation theme system (theme-loader.js /
// theme-runtime.js): skins here are simple static-image themes described by
// `themes/<id>/theme.json` with `isColoringSkin`, `states`, `patterns` and
// `accessories` fields.
//
// A skin theme.json may ALSO carry the heavy theme fields (the shipped cat
// theme does, so it can boot the legacy renderer); this loader only reads the
// simple skin fields and tolerates both:
//   - simple spec shape:  "states": { "idle": "./assets/idle.png", ... }
//   - heavy hybrid shape: "states": { "idle": ["./assets/base_cat.png"], ... }
//
// Adding a new skin needs NO code change: drop a folder under `themes/`
// (builtin) or `<userData>/themes/` with a theme.json that declares
// `isColoringSkin`; discovery scans both directories at call time.

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

let builtinThemesDir = null; // <app>/themes
let userThemesDir = null;    // <userData>/themes

/**
 * Initialize the loader. Call once at startup from main.js.
 * @param {string} appDir - __dirname of the calling module (src/)
 * @param {string} [userData] - app.getPath("userData")
 */
function init(appDir, userData) {
  builtinThemesDir = path.join(appDir, "..", "themes");
  if (userData) {
    userThemesDir = path.join(userData, "themes");
  }
}

function getBuiltinThemesDir() {
  return builtinThemesDir;
}

function getUserThemesDir() {
  return userThemesDir;
}

// ── Skin schema ──

// Logical skin states → where to look in theme.json (first hit wins).
// Hybrid themes name the focus visual "working"/completion "attention";
// simple-spec themes name them "studying"/"reward".
const SKIN_STATE_LOOKUP = Object.freeze({
  idle: ["idle"],
  studying: ["studying", "working"],
  reward: ["reward", "attention", "notification"],
  sleeping: ["sleeping", "idle"],
});

const PRESET_COLORS = Object.freeze([
  "#ffffff",
  "#ffddaa",
  "#f5a65b",
  "#999999",
  "#333333",
]);

// A state entry may be a string path, an array of files (first wins), or an
// object with `files` / `fallbackTo`.
function firstDeclaredFile(entry) {
  if (typeof entry === "string" && entry) return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      if (typeof item === "string" && item) return item;
    }
    return null;
  }
  if (entry && typeof entry === "object") {
    if (Array.isArray(entry.files)) {
      for (const item of entry.files) {
        if (typeof item === "string" && item) return item;
      }
    }
    if (typeof entry.fallbackTo === "string" && entry.fallbackTo) {
      return { fallbackTo: entry.fallbackTo };
    }
  }
  return null;
}

// Resolve a declared asset ("./assets/x.png", "./assets/patterns/x.png" or
// "x.png") against the theme directory, preserving any subfolder under
// assets/. Missing files are reported instead of throwing so the UI can show
// a placeholder and future art drops in without code changes.
function resolveThemeAsset(themeDir, declaredSrc, assetsUrl) {
  if (typeof declaredSrc !== "string" || !declaredSrc) {
    return { url: null, file: null, missing: true };
  }
  let rel = declaredSrc.replace(/\\/g, "/").replace(/^\.\//, "");
  const marker = "assets/";
  const markerIndex = rel.indexOf(marker);
  if (markerIndex !== -1) rel = rel.slice(markerIndex + marker.length);
  const segments = rel.split("/").filter(Boolean);
  if (segments.length === 0) return { url: null, file: null, missing: true };

  const abs = path.join(themeDir, "assets", ...segments);
  let exists = false;
  try { exists = fs.existsSync(abs); } catch { exists = false; }
  const urlPath = segments.map((seg) => encodeURIComponent(seg)).join("/");
  return {
    url: exists ? `${assetsUrl}/${urlPath}` : null,
    file: segments[segments.length - 1],
    missing: !exists,
  };
}

function resolveStateWithFallback(statesRaw, keys, themeDir, assetsUrl) {
  for (const key of keys) {
    const declared = firstDeclaredFile(statesRaw ? statesRaw[key] : null);
    if (declared && typeof declared === "object" && declared.fallbackTo) {
      // Follow one fallbackTo hop (e.g. notification -> attention).
      const fb = firstDeclaredFile(statesRaw ? statesRaw[declared.fallbackTo] : null);
      if (typeof fb === "string") {
        return resolveThemeAsset(themeDir, fb, assetsUrl);
      }
      continue;
    }
    if (typeof declared === "string") {
      return resolveThemeAsset(themeDir, declared, assetsUrl);
    }
  }
  return { url: null, file: null, missing: true };
}

function normalizeLayerList(list, themeDir, assetsUrl) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.id !== "string" || !item.id) continue;
    const asset = resolveThemeAsset(themeDir, item.src, assetsUrl);
    out.push({
      id: item.id,
      name: typeof item.name === "string" && item.name ? item.name : item.id,
      url: asset.url,
      file: asset.file,
      missing: asset.missing,
    });
  }
  return out;
}

/**
 * Build a skin descriptor from a parsed theme.json.
 * Returns null for folders that are not character skins.
 */
function buildSkinDescriptor(id, raw, themeDir, builtin) {
  if (!raw || typeof raw !== "object") return null;
  // Explicit opt-in: only themes that declare isColoringSkin are skins.
  // (Legacy SVG-animation themes never set it.)
  if (!Object.prototype.hasOwnProperty.call(raw, "isColoringSkin")) return null;

  const assetsUrl = builtin
    ? `../themes/${id}/assets`
    : pathToFileURL(path.join(themeDir, "assets")).href;

  const states = {};
  for (const [skinKey, keys] of Object.entries(SKIN_STATE_LOOKUP)) {
    states[skinKey] = resolveStateWithFallback(raw.states, keys, themeDir, assetsUrl);
  }

  const baseImage = resolveThemeAsset(themeDir, raw.baseImage, assetsUrl);
  const patterns = normalizeLayerList(raw.patterns, themeDir, assetsUrl);
  const accessories = normalizeLayerList(raw.accessories, themeDir, assetsUrl);

  return {
    id,
    name: typeof raw.name === "string" && raw.name ? raw.name : id,
    description: typeof raw.description === "string" ? raw.description : "",
    version: typeof raw.version === "string" ? raw.version : "",
    isColoringSkin: raw.isColoringSkin !== false,
    builtin: !!builtin,
    themeDir,
    assetsUrl,
    viewBox: raw.viewBox && Number.isFinite(raw.viewBox.width)
      ? { x: raw.viewBox.x || 0, y: raw.viewBox.y || 0, width: raw.viewBox.width, height: raw.viewBox.height }
      : { x: 0, y: 0, width: 512, height: 512 },
    baseImage,
    states,
    patterns,
    accessories,
    presetColors: PRESET_COLORS,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string") : [],
  };
}

function readThemeJson(jsonPath) {
  try {
    return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  } catch (err) {
    console.warn(`[character-loader] failed to read ${jsonPath}:`, err && err.message);
    return null;
  }
}

function scanSkinsDir(dir, builtin, out, seen) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // dir not found — no skins there
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (entry.name === "template") continue;
    if (seen.has(entry.name)) continue; // builtin wins over user themes
    const themeDir = path.join(dir, entry.name);
    const raw = readThemeJson(path.join(themeDir, "theme.json"));
    if (!raw) continue;
    const skin = buildSkinDescriptor(entry.name, raw, themeDir, builtin);
    if (!skin) continue;
    out.push(skin);
    seen.add(entry.name);
  }
}

/**
 * Discover all available character skins (builtin first, then user-installed).
 * @returns {Array<object>} skin descriptors
 */
function discoverSkins() {
  const skins = [];
  const seen = new Set();
  if (builtinThemesDir) scanSkinsDir(builtinThemesDir, true, skins, seen);
  if (userThemesDir) scanSkinsDir(userThemesDir, false, skins, seen);
  return skins;
}

/**
 * Load a single skin descriptor by id (builtin then user dir).
 * Returns null when missing or not a skin.
 */
function getSkin(themeId) {
  if (typeof themeId !== "string" || !themeId) return null;
  return discoverSkins().find((skin) => skin.id === themeId) || null;
}

module.exports = {
  init,
  getBuiltinThemesDir,
  getUserThemesDir,
  discoverSkins,
  getSkin,
  buildSkinDescriptor,
  PRESET_COLORS,
  SKIN_STATE_LOOKUP,
};
