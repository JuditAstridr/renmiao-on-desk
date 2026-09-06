"use strict";

const { commitPetAccessoryPayload } = require("./pet-accessory-state");
const renmiAccessoryConfig = require("../themes/renmi/accessories.json");

// Canonical catalogs for pet customization choices. Persisted settings store
// stable ids only; renderer-facing values are resolved here so neither menus
// nor untrusted preference data can supply CSS filters or asset paths.

const PET_TINT_CATALOG = Object.freeze([
  Object.freeze({ id: "none", labelKey: "tintNone", filter: "" }),
  Object.freeze({ id: "midnight", labelKey: "tintMidnight", filter: "hue-rotate(200deg) saturate(1.2) brightness(0.82)" }),
  Object.freeze({ id: "gold", labelKey: "tintGold", filter: "sepia(0.8) saturate(2.2) hue-rotate(-18deg) brightness(1.05)" }),
  Object.freeze({ id: "vaporwave", labelKey: "tintVaporwave", filter: "hue-rotate(265deg) saturate(1.6) contrast(1.05)" }),
  Object.freeze({ id: "matcha", labelKey: "tintMatcha", filter: "hue-rotate(75deg) saturate(1.25) brightness(1)" }),
  Object.freeze({ id: "mono", labelKey: "tintMono", filter: "grayscale(1) brightness(1.05)" }),
]);

const PET_TINT_BY_ID = new Map(PET_TINT_CATALOG.map((entry) => [entry.id, entry]));
const PET_TINT_IDS = Object.freeze(PET_TINT_CATALOG.map((entry) => entry.id));

// Theme-owned tint ids intentionally stay outside the global Clawd catalog.
// They are still validated and resolved through this module, but are exposed
// only when the owning theme asks for them. This keeps Clawd's existing
// Customize choices unchanged while allowing a built-in theme to describe a
// different color vocabulary.
const THEME_PET_TINT_CATALOG = Object.freeze({
  renmi: Object.freeze([
    Object.freeze({ id: "cream", labelKey: "tintCream" }),
    Object.freeze({ id: "light-gray", labelKey: "tintLightGray" }),
    Object.freeze({ id: "light-brown", labelKey: "tintLightBrown" }),
  ]),
});

const THEME_PET_TINT_BY_THEME = new Map(
  Object.entries(THEME_PET_TINT_CATALOG).map(([themeId, entries]) => [
    themeId,
    new Map(entries.map((entry) => [entry.id, entry])),
  ])
);

function freezeAccessory({ id, labelKey, file = null, viewBox = null, widthScale = 1, offsetY = 0, themeWidthScales = null, unlockPoints = 0 }) {
  return Object.freeze({
    id,
    labelKey,
    file,
    viewBox: viewBox ? Object.freeze({ ...viewBox }) : null,
    widthScale,
    offsetY,
    themeWidthScales: themeWidthScales ? Object.freeze({ ...themeWidthScales }) : null,
    unlockPoints,
  });
}

const PET_ACCESSORY_CATALOG = Object.freeze([
  freezeAccessory({ id: "none", labelKey: "accessoryNone" }),
  freezeAccessory({ id: "cowboy-hat", labelKey: "accessoryCowboyHat", file: "cowboy-hat.svg", viewBox: { x: 0, y: 0, width: 16, height: 7 } }),
  freezeAccessory({ id: "party-hat", labelKey: "accessoryPartyHat", file: "party-hat.svg", viewBox: { x: 0, y: 0, width: 11, height: 14 }, widthScale: 0.7, offsetY: 0.3 }),
  freezeAccessory({ id: "wizard-hat", labelKey: "accessoryWizardHat", file: "wizard-hat.svg", viewBox: { x: 0, y: 0, width: 15, height: 16 }, widthScale: 0.95, offsetY: 0.3 }),
  freezeAccessory({ id: "top-hat", labelKey: "accessoryTopHat", file: "top-hat.svg", viewBox: { x: 0, y: 0, width: 14, height: 10 }, widthScale: 0.88, offsetY: 0.2 }),
  freezeAccessory({ id: "santa-hat", labelKey: "accessorySantaHat", file: "santa-hat.svg", viewBox: { x: 0, y: 0, width: 16, height: 9 }, offsetY: 0.2 }),
  freezeAccessory({ id: "pumpkin-hat", labelKey: "accessoryPumpkinHat", file: "pumpkin-hat.svg", viewBox: { x: 0, y: 0, width: 13, height: 9 }, widthScale: 0.85, offsetY: 0.4 }),
  freezeAccessory({ id: "halo", labelKey: "accessoryHalo", file: "halo.svg", viewBox: { x: 0, y: 0, width: 14, height: 5 }, widthScale: 1.15, offsetY: -1.4, themeWidthScales: { clawd: 0.9 } }),
]);

const PET_ACCESSORY_BY_ID = new Map(PET_ACCESSORY_CATALOG.map((entry) => [entry.id, entry]));
const PET_ACCESSORY_IDS = Object.freeze(PET_ACCESSORY_CATALOG.map((entry) => entry.id));

// Renmi's chest badges are deliberately theme-owned. Keeping them out of the
// global Clawd wardrobe means the existing Clawd selector, holiday logic, and
// persisted choices cannot accidentally expose or render them for another
// theme. The JSON file is the theme-owned source of truth for badge order and
// geometry; points are read from the account-scoped Study Companion state by
// the main process; `unlocked` is only a derived UI hint and never persisted.
const THEME_PET_ACCESSORY_CATALOG = Object.freeze({
  renmi: Object.freeze(renmiAccessoryConfig.badges.map((entry) => freezeAccessory(entry))),
});

const THEME_PET_ACCESSORY_BY_THEME = new Map(
  Object.entries(THEME_PET_ACCESSORY_CATALOG).map(([themeId, entries]) => [
    themeId,
    new Map(entries.map((entry) => [entry.id, entry])),
  ])
);

function isPetTintId(value) {
  return typeof value === "string" && PET_TINT_BY_ID.has(value);
}

function isPetTintIdForTheme(value, themeId) {
  if (isPetTintId(value)) return true;
  if (typeof themeId !== "string" || !themeId) return false;
  const themeCatalog = THEME_PET_TINT_BY_THEME.get(themeId);
  return !!(themeCatalog && themeCatalog.has(value));
}

function getPetTint(value) {
  return PET_TINT_BY_ID.get(value) || PET_TINT_BY_ID.get("none");
}

function getPetTintIdForTheme(selections, themeId) {
  if (typeof selections === "string") return getPetTint(selections).id;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return "none";
  if (typeof themeId !== "string" || !themeId) return "none";
  const value = selections[themeId];
  if (isPetTintId(value)) return value;
  return isPetTintIdForTheme(value, themeId) ? value : "none";
}

function isPetTintSupportedForTheme(theme) {
  if (!theme) return true;
  return !!(theme._capabilities && theme._capabilities.petTint === true);
}

function resolvePetTintPayload(value, theme = null) {
  if (!isPetTintSupportedForTheme(theme)) return { id: "none", filter: "" };
  const entry = getPetTint(value);
  if (entry.id !== "none" || value === "none") {
    return { id: entry.id, filter: entry.filter };
  }
  const themeId = theme && theme._id;
  if (isPetTintIdForTheme(value, themeId)) return { id: value, filter: "" };
  return { id: "none", filter: "" };
}

function listPetTintOptions(themeId = null) {
  const options = PET_TINT_CATALOG.map(({ id, labelKey }) => ({ id, labelKey }));
  const themeCatalog = THEME_PET_TINT_BY_THEME.get(themeId);
  if (themeCatalog) {
    options.push(...[...themeCatalog.values()].map(({ id, labelKey }) => ({ id, labelKey })));
  }
  return options;
}

function getPetTintSaturationConfig(theme) {
  const config = theme
    && theme.customization
    && theme.customization.petTintSaturation;
  if (!config || typeof config !== "object" || config.enabled !== true) return null;
  const min = Number.isFinite(config.min) ? config.min : 0;
  const max = Number.isFinite(config.max) ? config.max : 200;
  const step = Number.isFinite(config.step) && config.step > 0 ? config.step : 1;
  const defaultValue = Number.isFinite(config.default)
    ? config.default
    : 100;
  if (min < 0 || max > 200 || min >= max || defaultValue < min || defaultValue > max) return null;
  return { enabled: true, min, max, step, default: defaultValue };
}

function getPetTintSaturationForTheme(selections, theme) {
  const config = getPetTintSaturationConfig(theme);
  if (!config) return 100;
  const themeId = theme && theme._id;
  const value = selections
    && typeof selections === "object"
    && !Array.isArray(selections)
    && typeof themeId === "string"
    ? selections[themeId]
    : undefined;
  if (!Number.isFinite(value) || value < config.min || value > config.max) return config.default;
  return value;
}

function isPetAccessoryId(value) {
  return typeof value === "string" && PET_ACCESSORY_BY_ID.has(value);
}

function isPetAccessoryIdForTheme(value, themeId) {
  if (value === "none") return true;
  if (typeof themeId !== "string" || !themeId) return false;
  const themeCatalog = THEME_PET_ACCESSORY_BY_THEME.get(themeId);
  // A theme-owned wardrobe is intentionally closed: Renmi's chest badges
  // must not be mixed with Clawd's hat catalog. Themes without an owned
  // catalog retain the historical global accessory list.
  return themeCatalog ? themeCatalog.has(value) : isPetAccessoryId(value);
}

function getPetAccessory(value) {
  return PET_ACCESSORY_BY_ID.get(value) || PET_ACCESSORY_BY_ID.get("none");
}

function getPetAccessoryForTheme(value, themeId) {
  if (typeof themeId === "string" && themeId) {
    const themeCatalog = THEME_PET_ACCESSORY_BY_THEME.get(themeId);
    const themeEntry = themeCatalog && themeCatalog.get(value);
    if (themeEntry) return themeEntry;
    if (themeCatalog) return getPetAccessory("none");
  }
  return getPetAccessory(value);
}

function getPetAccessoryUnlockPoints(value, themeId) {
  const entry = getPetAccessoryForTheme(value, themeId);
  return Number.isFinite(entry.unlockPoints) ? entry.unlockPoints : 0;
}

function isPetAccessoryUnlockedForTheme(value, themeId, pointsTotal) {
  const required = getPetAccessoryUnlockPoints(value, themeId);
  if (required <= 0) return true;
  return Number.isFinite(pointsTotal) && pointsTotal >= required;
}

function getPetAccessoryIdForTheme(selections, themeId, pointsTotal = null) {
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return "none";
  if (typeof themeId !== "string" || !themeId) return "none";
  const value = selections[themeId];
  if (!isPetAccessoryIdForTheme(value, themeId)) return "none";
  if (!isPetAccessoryUnlockedForTheme(value, themeId, pointsTotal)) return "none";
  return getPetAccessoryForTheme(value, themeId).id;
}

function isPetAccessorySupportedForTheme(theme) {
  if (!theme) return false;
  return !!(theme._capabilities && theme._capabilities.accessories === true);
}

// Pure resolver for callers that must not make a candidate authoritative until
// renderer delivery succeeds (Settings and holiday refresh use this path).
function buildPetAccessoryPayload(value, theme = null, options = {}) {
  const themeId = theme && theme._id;
  const entry = getPetAccessoryForTheme(value, themeId);
  const supported = isPetAccessorySupportedForTheme(theme);
  if (
    !supported
    || entry.id === "none"
    || !isPetAccessoryUnlockedForTheme(entry.id, themeId, options.pointsTotal)
  ) {
    return { id: "none", assetFile: null, aspect: 1, widthScale: 1, offsetY: 0 };
  }
  return {
    id: entry.id,
    assetFile: entry.file,
    aspect: entry.viewBox.width / entry.viewBox.height,
    widthScale: (
      theme
      && theme._builtin === true
      && entry.themeWidthScales
      && entry.themeWidthScales[theme._id]
    ) || entry.widthScale,
    offsetY: entry.offsetY,
  };
}

// Renderer config/theme reloads call this resolver. Committing here means the
// exact payload handed to the renderer also becomes the main-process geometry
// authority, instead of geometry independently re-resolving settings/date.
function resolvePetAccessoryPayload(value, theme = null, options = {}) {
  const payload = buildPetAccessoryPayload(value, theme, options);
  return commitPetAccessoryPayload(payload, theme).payload;
}

function listPetAccessoryOptions(themeId = null, pointsTotal = null) {
  const themeCatalog = THEME_PET_ACCESSORY_CATALOG[themeId];
  if (!themeCatalog) {
    return PET_ACCESSORY_CATALOG.map(({ id, labelKey }) => ({ id, labelKey }));
  }
  return [
    { id: "none", labelKey: "accessoryNone", unlockPoints: 0, unlocked: true },
    ...themeCatalog.map(({ id, labelKey, unlockPoints }) => ({
      id,
      labelKey,
      unlockPoints,
      unlocked: isPetAccessoryUnlockedForTheme(id, themeId, pointsTotal),
    })),
  ];
}

module.exports = {
  PET_TINT_CATALOG,
  PET_TINT_IDS,
  isPetTintId,
  isPetTintIdForTheme,
  THEME_PET_TINT_CATALOG,
  getPetTint,
  getPetTintIdForTheme,
  isPetTintSupportedForTheme,
  resolvePetTintPayload,
  listPetTintOptions,
  getPetTintSaturationConfig,
  getPetTintSaturationForTheme,
  PET_ACCESSORY_CATALOG,
  PET_ACCESSORY_IDS,
  isPetAccessoryId,
  THEME_PET_ACCESSORY_CATALOG,
  isPetAccessoryIdForTheme,
  getPetAccessory,
  getPetAccessoryForTheme,
  getPetAccessoryUnlockPoints,
  isPetAccessoryUnlockedForTheme,
  getPetAccessoryIdForTheme,
  isPetAccessorySupportedForTheme,
  buildPetAccessoryPayload,
  resolvePetAccessoryPayload,
  listPetAccessoryOptions,
};
