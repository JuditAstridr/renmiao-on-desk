"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SRC_DIR = path.join(__dirname, "..", "src");

function read(name) {
  return fs.readFileSync(path.join(SRC_DIR, name), "utf8");
}

test("Remote Approval is removed from the Settings surface", () => {
  const renderer = read("settings-renderer.js");
  const html = read("settings.html");
  const icons = read("settings-icons.js");
  const preload = read("preload-settings.js");
  const uiCore = read("settings-ui-core.js");
  const ipc = read("settings-ipc.js");
  const css = read("settings.css");

  assert.doesNotMatch(renderer, /telegram-approval|sidebarTelegramApproval|remoteApproval/);
  assert.doesNotMatch(html, /settings-tab-telegram-approval|settings-tab-mobile|feishu-approval-recipient/);
  assert.doesNotMatch(icons, /telegram-approval/);
  assert.doesNotMatch(preload, /remoteApproval|MobileConnection|mobile-connection|regenerateMobile|resetMobile/);
  assert.doesNotMatch(uiCore, /remoteApprovalSubtab/);
  assert.doesNotMatch(ipc, /settings:(?:mobile-connection-info|regenerate-mobile-token|reset-mobile-access)/);
  assert.doesNotMatch(css, /remote-approval|tg-approval|feishu-approval|slack-notify|mobile-action-btn/);
  assert.equal(fs.existsSync(path.join(SRC_DIR, "settings-tab-telegram-approval.js")), false);
  assert.equal(fs.existsSync(path.join(SRC_DIR, "settings-tab-mobile.js")), false);
});

test("other Settings tabs remain available after Remote Approval removal", () => {
  const renderer = read("settings-renderer.js");
  for (const id of [
    "general",
    "study",
    "theme",
    "animOverrides",
    "shortcuts",
  ]) {
    assert.match(renderer, new RegExp(`id: "${id}"`));
  }
});
