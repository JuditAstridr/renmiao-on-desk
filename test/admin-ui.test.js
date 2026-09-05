"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("admin edit uses an in-app dialog in both admin clients", () => {
  for (const relativePath of ["src/admin-renderer.js", "cloud/admin/admin.js"]) {
    const source = read(relativePath);
    assert.equal(source.includes("window.prompt("), false, relativePath + " must not use unsupported prompt()");
    assert.match(source, /openEditDialog/);
    assert.match(source, /user-edit-form/);
  }
  for (const relativePath of ["src/admin.html", "cloud/admin/index.html"]) {
    assert.match(read(relativePath), /id="user-edit-dialog"/);
  }
});

test("revoke-session backend interfaces remain available while admin buttons are removed", () => {
  assert.equal(read("src/admin-renderer.js").includes('data-action="revoke"'), false);
  assert.equal(read("cloud/admin/admin.js").includes('data-action="revoke"'), false);
  assert.match(read("src/preload-admin.js"), /revokeUserSessions/);
  assert.match(read("cloud/api/server.js"), /sessions[^\n]*revoke/);
  assert.match(read("cloud/api/auth-service.js"), /async function revokeUserSessions/);
});
