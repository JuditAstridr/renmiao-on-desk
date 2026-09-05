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
  const meBody = await me.json();
  assert.equal(meBody.user.username, "Student");
  const profileResponse = await call("/v1/me/profile", {
    headers: { Authorization: `Bearer ${login.accessToken}` },
    method: "GET",
  });
  const initialProfile = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(initialProfile.profile.pet.themeId, "renmi");
  const profileUpdate = await call("/v1/me/profile", {
    headers: { Authorization: `Bearer ${login.accessToken}` },
    method: "PATCH",
    body: {
      expectedUpdatedAt: initialProfile.profileUpdatedAt,
      profile: {
        pet: { themeId: "cloudling", variantId: "default" },
        study: { tasks: [{ id: "task-1", title: "Persist this" }], points: { total: 30 } },
      },
    },
  });
  const profileUpdateBody = await profileUpdate.json();
  assert.equal(profileUpdate.status, 200);
  assert.equal(profileUpdateBody.profile.study.points.total, 30);
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

  const adminProfile = await call(`/v1/admin/users/${encodeURIComponent(meBody.user.id)}/profile`, {
    headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    method: "GET",
  });
  const adminProfileBody = await adminProfile.json();
  assert.equal(adminProfile.status, 200);
  assert.equal(adminProfileBody.profile.pet.themeId, "cloudling");
  const adminProfileUpdate = await call(`/v1/admin/users/${encodeURIComponent(meBody.user.id)}/profile`, {
    headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    method: "PATCH",
    body: {
      expectedUpdatedAt: adminProfileBody.profileUpdatedAt,
      profile: { ...adminProfileBody.profile, study: { ...adminProfileBody.profile.study, points: { total: 999 } } },
    },
  });
  const adminProfileUpdateBody = await adminProfileUpdate.json();
  assert.equal(adminProfileUpdate.status, 200);
  assert.equal(adminProfileUpdateBody.profile.study.points.total, 999);

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
