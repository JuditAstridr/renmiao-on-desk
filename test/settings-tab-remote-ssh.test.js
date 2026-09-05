"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC_DIR = path.join(__dirname, "..", "src");

test("SSH Hosts is removed from the Settings surface", () => {
  const renderer = fs.readFileSync(path.join(SRC_DIR, "settings-renderer.js"), "utf8");
  const html = fs.readFileSync(path.join(SRC_DIR, "settings.html"), "utf8");
  const icons = fs.readFileSync(path.join(SRC_DIR, "settings-icons.js"), "utf8");
  const preload = fs.readFileSync(path.join(SRC_DIR, "preload-settings.js"), "utf8");

  assert.doesNotMatch(renderer, /remote-ssh|sidebarRemoteSsh/);
  assert.doesNotMatch(html, /settings-tab-remote-ssh/);
  assert.doesNotMatch(icons, /remote-ssh/);
  assert.doesNotMatch(preload, /remoteSsh/);
  assert.equal(fs.existsSync(path.join(SRC_DIR, "settings-tab-remote-ssh.js")), false);
});

test("other Settings tabs remain registered after removing SSH Hosts", () => {
  const renderer = fs.readFileSync(path.join(SRC_DIR, "settings-renderer.js"), "utf8");
  for (const id of ["general", "agents", "theme", "animOverrides", "shortcuts", "discord-presence", "about"]) {
    assert.match(renderer, new RegExp(`id: "${id}"`));
  }
});
