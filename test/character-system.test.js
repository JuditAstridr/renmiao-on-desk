"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const characterConfig = require("../src/character-config");
const characterLoader = require("../src/character-loader");
const themeLoader = require("../src/theme-loader");

const REPO_ROOT = path.resolve(__dirname, "..");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "renmi-character-test-"));
}

test("character loader discovers skins without leaking them into legacy themes", () => {
  const userData = makeTempDir();
  try {
    characterLoader.init(path.join(REPO_ROOT, "src"), userData);
    const skins = characterLoader.discoverSkins();
    const cat = skins.find((skin) => skin.id === "cat");

    assert.ok(cat, "the bundled cat skin should be discoverable");
    assert.equal(cat.isColoringSkin, true);
    assert.equal(cat.states.studying.file, "studying.png");
    assert.equal(cat.states.reward.file, "reward.png");
    assert.equal(cat.states.sleeping.file, "idle.png");
    assert.equal(cat.patterns.find((item) => item.id === "stripe").missing, true);
    assert.equal(cat.accessories.find((item) => item.id === "scarf").missing, true);

    themeLoader.init(path.join(REPO_ROOT, "src"), userData);
    assert.equal(themeLoader.discoverThemes().some((theme) => theme.id === "cat"), false);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test("character config stays inactive until confirmed and persists normalized choices", () => {
  const userData = makeTempDir();
  try {
    characterLoader.init(path.join(REPO_ROOT, "src"), userData);
    characterConfig.init(userData);

    const initial = characterConfig.resolvePayload(characterLoader);
    assert.equal(initial.active, false);
    assert.equal(characterConfig.isConfigured(), false);

    const saved = characterConfig.saveConfig({
      themeId: "cat",
      color: "#12abef",
      size: 99,
      selectedPatterns: ["stripe", "stripe"],
    });
    assert.equal(saved.configured, true);
    assert.equal(saved.size, characterConfig.MAX_SIZE);
    assert.deepEqual(saved.selectedPatterns, ["stripe"]);

    const payload = characterConfig.resolvePayload(characterLoader);
    assert.equal(payload.active, true);
    assert.equal(payload.skin.id, "cat");
    assert.equal(payload.config.color, "#12abef");

    characterConfig.init(userData);
    assert.equal(characterConfig.getConfig().configured, true);
    assert.equal(characterConfig.getConfig().themeId, "cat");
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});
