"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createConfig } = require("../cloud/api/config");
const { createMemoryRepository } = require("../cloud/api/memory-repository");
const { createAuthService } = require("../cloud/api/auth-service");
const { createAuthHttpServer } = require("../cloud/api/server");
const { hashPassword } = require("../cloud/api/auth-core");

test("HTTP API supports registration, self lookup, and admin-only user listing", async (t) => {
  const sent = [];
  const config = createConfig({ AUTH_DEV_MODE: "1", RENMI_ADMIN_PASSWORD_HASH: await hashPassword("Admin-Password-For-Test-123") });
  const repo = createMemoryRepository();
  const service = createAuthService({
    repo,
    config,
    emailer: { async sendVerificationCode(payload) { sent.push(payload); } },
  });
  await service.ensureAdmin();
  const server = createAuthHttpServer({ service, config });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const call = (path, options = {}) => fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  assert.equal((await call("/health")).status, 200);
  const registerResponse = await call("/v1/auth/register/request", {
    method: "POST",
    body: { username: "Student", email: "student@ruc.edu.cn", password: "Correct-Horse-466743" },
  });
  const register = await registerResponse.json();
  assert.equal(registerResponse.status, 200);
  const verifyResponse = await call("/v1/auth/register/verify", {
    method: "POST",
    body: { challengeId: register.challengeId, code: sent.at(-1).code },
  });
  const login = await verifyResponse.json();
  assert.equal(verifyResponse.status, 200);
  const me = await call("/v1/me", { headers: { Authorization: `Bearer ${login.accessToken}` }, method: "GET" });
  assert.equal((await me.json()).user.username, "Student");
  const forbidden = await call("/v1/admin/users", { headers: { Authorization: `Bearer ${login.accessToken}` }, method: "GET" });
  assert.equal(forbidden.status, 403);

  const adminStartResponse = await call("/v1/admin/auth/start", {
    method: "POST",
    body: { email: config.adminEmail, password: "Admin-Password-For-Test-123" },
  });
  const adminStart = await adminStartResponse.json();
  const adminVerify = await call("/v1/admin/auth/verify", {
    method: "POST",
    body: { challengeId: adminStart.challengeId, code: sent.at(-1).code },
  });
  const adminLogin = await adminVerify.json();
  const users = await call("/v1/admin/users", { headers: { Authorization: `Bearer ${adminLogin.accessToken}` }, method: "GET" });
  const usersBody = await users.json();
  assert.equal(users.status, 200);
  assert.deepEqual(usersBody.rows.map((user) => user.email), ["student@ruc.edu.cn"]);

  const resetResponse = await call(`/v1/admin/users/${encodeURIComponent(usersBody.rows[0].id)}/password/reset`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    body: { password: "New-Password-466743" },
  });
  const reset = await resetResponse.json();
  assert.equal(resetResponse.status, 200);
  assert.equal(reset.revoked, 1);
  assert.equal((await call("/v1/me", { headers: { Authorization: `Bearer ${login.accessToken}` }, method: "GET" })).status, 401);
  const newUserLogin = await call("/v1/auth/login/password", {
    method: "POST",
    body: { email: "student@ruc.edu.cn", password: "New-Password-466743" },
  });
  assert.equal(newUserLogin.status, 200);
});
