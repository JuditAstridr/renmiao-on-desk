"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { DEFAULT_AUTH_API_URL, normalizeApiUrl, resolveAuthApiUrl } = require("../src/auth-config");

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
      return JSON.stringify({ version: 1, apiUrl: "https://auth.example.net/" });
    } },
  }), "https://auth.example.net");
});

test("packaged startup can use the shared Renmiao endpoint when no build env is present", () => {
  assert.equal(resolveAuthApiUrl({ env: {}, resourcesPath: "", userDataDir: "", defaultApiUrl: DEFAULT_AUTH_API_URL }), DEFAULT_AUTH_API_URL);
  assert.equal(DEFAULT_AUTH_API_URL, "https://renmiao.org");
});

test("placeholder auth endpoints are ignored in favor of the real packaged default", () => {
  assert.equal(resolveAuthApiUrl({
    env: { RENMI_AUTH_API_URL: "https://auth.example.invalid" },
    resourcesPath: "",
    userDataDir: "",
    defaultApiUrl: DEFAULT_AUTH_API_URL,
  }), DEFAULT_AUTH_API_URL);
});
