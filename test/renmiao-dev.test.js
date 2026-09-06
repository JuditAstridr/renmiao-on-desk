"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveRemoteAuthUrl, waitForRemoteHealth } = require("../scripts/renmiao-dev");

test("development launcher uses a configured shared auth API instead of starting a local database", () => {
  assert.equal(resolveRemoteAuthUrl({ RENMI_AUTH_API_URL: "https://renmiao.org/" }), "https://renmiao.org");
  assert.equal(resolveRemoteAuthUrl({ RENMI_AUTH_API_URL: "https://renmiao.org", RENMI_LOCAL_AUTH: "1" }), "");
  assert.equal(resolveRemoteAuthUrl({}), "");
});

test("development launcher rejects placeholder shared auth endpoints", () => {
  assert.throws(
    () => resolveRemoteAuthUrl({ RENMI_AUTH_API_URL: "https://auth.example.invalid" }),
    /真实.*认证服务地址/,
  );
});

test("development launcher waits for a healthy shared auth API", async () => {
  let calls = 0;
  await waitForRemoteHealth("https://renmiao.org", 100, async () => {
    calls += 1;
    return { ok: calls >= 1 };
  });
  assert.equal(calls, 1);
});
