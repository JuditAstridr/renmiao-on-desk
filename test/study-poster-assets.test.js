"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("node:test");
const themeLoader = require("../src/theme-loader");
const {
  getEffectivePetAccessoryIdForTheme,
} = require("../src/holiday-accessory");
const {
  buildPetAccessoryPayload,
  getPetTintIdForTheme,
  resolvePetTintPayload,
} = require("../src/pet-customization-catalog");
const { createStudyPosterAssets, POSTER_KIT_MANIFEST } = require("../src/study-poster-assets");

const root = path.join(__dirname, "..");

describe("Study poster asset resolver", () => {
  it("returns the active Renmi frames, tint, accessory, kit, and font", () => {
    themeLoader.init(path.join(root, "src"), path.join(root, "test", ".poster-profile"));
    const theme = themeLoader.loadTheme("renmi", { strict: true });
    const assets = createStudyPosterAssets({
      themeLoader,
      getActiveTheme: () => theme,
      getSettingsSnapshot: () => ({
        petTint: { renmi: "cream" },
        petAccessory: { renmi: "renmi-ruc" },
        holidayAccessoryEnabled: {},
      }),
      getPetTintIdForTheme,
      resolvePetTintPayload,
      getEffectivePetAccessoryIdForTheme,
      buildPetAccessoryPayload,
      getStudyPoints: () => 60,
      rootDir: root,
    });
    const pet = assets.getActivePet();
    assert.equal(pet.id, "renmi");
    assert.ok(pet.frames.idle.startsWith("data:image/svg+xml"));
    assert.match(pet.frames.idle, /data%3Aimage%2Fpng%3Bbase64%2C/);
    assert.ok(pet.frames.thinking);
    assert.equal(pet.tint, "");
    assert.ok(pet.accessory && pet.accessory.svg.startsWith("data:image/svg+xml"));
    assert.deepEqual(Object.keys(assets.getPosterAssets(Object.keys(POSTER_KIT_MANIFEST))).sort(), Object.keys(POSTER_KIT_MANIFEST).sort());
    assert.ok(assets.getPosterFont().base64.length > 100);
  });
});
