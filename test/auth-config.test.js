"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeApiUrl, resolveAuthApiUrl } = require("../src/auth-config");

test("auth API URL prefers the environment and normalizes trailing slashes", () => {
  assert.equal(normalizeApiUrl("https://auth.example.com///"), "https://auth.example.com");
  assert.equal(resolveAuthApiUrl({
    env: { RENMI_AUTH_API_URL: "https://env.example.com/" },
    resourcesPath: "/unused",
    fs: { readFileSync() { throw new Error("should not read packaged config"); } },
  }), "https://env.example.com");
});

test("auth API URL falls back to the packaged non-secret endpoint", () => {
  assert.equal(resolveAuthApiUrl({
    env: {},
    resourcesPath: "/app/resources",
    fs: { readFileSync(filename) {
      assert.equal(filename, "/app/resources/renmi-auth-config.json");
      return JSON.stringify({ version: 1, apiUrl: "https://auth.example.com/" });
    } },
  }), "https://auth.example.com");
});
