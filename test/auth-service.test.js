"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createConfig } = require("../cloud/api/config");
const { createMemoryRepository } = require("../cloud/api/memory-repository");
const { createAuthService, emailHash } = require("../cloud/api/auth-service");
const { hashPassword } = require("../cloud/api/auth-core");

function createHarness(configOverrides = {}) {
  const sent = [];
  const repo = createMemoryRepository();
  const config = createConfig({
    AUTH_DEV_MODE: "1",
    RENMI_ADMIN_PASSWORD_HASH: configOverrides.adminPasswordHash || "",
    ...configOverrides,
  });
  const emailer = {
    async sendVerificationCode(payload) { sent.push(payload); },
  };
  const service = createAuthService({ repo, emailer, config });
  return { sent, repo, config, service };
}

test("registration verifies email and creates a session", async () => {
  const harness = createHarness();
  const pending = await harness.service.registerRequest({
    username: "RUC Student",
    email: "student@ruc.edu.cn",
    password: "Correct-Horse-466743",
  });
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].purpose, "register");
  const result = await harness.service.registerVerify({
    challengeId: pending.challengeId,
    code: harness.sent[0].code,
    request: { ip: "127.0.0.1", userAgent: "test" },
  });
  assert.equal(result.user.email, "student@ruc.edu.cn");
  assert.equal(result.user.status, "active");
  assert.ok(result.refreshToken);
});

test("password and code login both work, while suspended accounts are rejected", async () => {
  const harness = createHarness();
  const registration = await harness.service.registerRequest({ username: "Student", email: "student@ruc.edu.cn", password: "Correct-Horse-466743" });
  await harness.service.registerVerify({ challengeId: registration.challengeId, code: harness.sent.pop().code });
  const passwordLogin = await harness.service.loginPassword({ email: "student@ruc.edu.cn", password: "Correct-Horse-466743" });
  assert.equal(passwordLogin.user.username, "Student");
  const codeRequest = await harness.service.loginCodeRequest({ email: "student@ruc.edu.cn" });
  const code = harness.sent[harness.sent.length - 1].code;
  const codeLogin = await harness.service.loginCodeVerify({ challengeId: codeRequest.challengeId, code });
  assert.equal(codeLogin.user.id, passwordLogin.user.id);
  await harness.service.updateUser({
    admin: { id: "admin-1" },
    userId: passwordLogin.user.id,
    patch: { status: "suspended", suspensionReason: "test" },
    request: {},
  }).catch((error) => assert.equal(error.code, undefined));
  await assert.rejects(() => harness.service.loginPassword({ email: "student@ruc.edu.cn", password: "Correct-Horse-466743" }), { code: "invalid_credentials" });
});

test("revoking a user's sessions also invalidates already-issued access tokens", async () => {
  const harness = createHarness();
  const registration = await harness.service.registerRequest({ username: "Student", email: "student@ruc.edu.cn", password: "Correct-Horse-466743" });
  await harness.service.registerVerify({ challengeId: registration.challengeId, code: harness.sent.pop().code });
  const login = await harness.service.loginPassword({ email: "student@ruc.edu.cn", password: "Correct-Horse-466743" });
  const user = await harness.repo.findUserByEmailHash(emailHash("student@ruc.edu.cn", harness.config.challengeSecret));
  await harness.service.revokeUserSessions({ admin: { id: "admin-1" }, userId: user.id, request: {} });
  await assert.rejects(() => harness.service.authenticateAccessToken(login.accessToken), { code: "session_expired" });
});

test("an administrator email change can be completed with the code sent to the new address", async () => {
  const harness = createHarness();
  const registration = await harness.service.registerRequest({ username: "Student", email: "student@ruc.edu.cn", password: "Correct-Horse-466743" });
  await harness.service.registerVerify({ challengeId: registration.challengeId, code: harness.sent.pop().code });
  const user = await harness.repo.findUserByEmailHash(emailHash("student@ruc.edu.cn", harness.config.challengeSecret));
  const update = await harness.service.updateUser({
    admin: { id: "admin-1" },
    userId: user.id,
    patch: { email: "new.student@ruc.edu.cn" },
    request: {},
  });
  assert.equal(update.user.status, "pending");
  const sentCode = harness.sent.at(-1).code;
  const verified = await harness.service.verifyEmailChange({ email: "new.student@ruc.edu.cn", code: sentCode });
  assert.equal(verified.user.status, "active");
  assert.equal(verified.user.email, "new.student@ruc.edu.cn");
});

test("changing a suspended user's email cannot silently reactivate the account", async () => {
  const harness = createHarness();
  const registration = await harness.service.registerRequest({ username: "Student", email: "student@ruc.edu.cn", password: "Correct-Horse-466743" });
  await harness.service.registerVerify({ challengeId: registration.challengeId, code: harness.sent.pop().code });
  const user = await harness.repo.findUserByEmailHash(emailHash("student@ruc.edu.cn", harness.config.challengeSecret));
  await harness.service.updateUser({ admin: { id: "admin-1" }, userId: user.id, patch: { status: "suspended" }, request: {} });
  await assert.rejects(
    () => harness.service.updateUser({ admin: { id: "admin-1" }, userId: user.id, patch: { email: "new.student@ruc.edu.cn" }, request: {} }),
    { code: "account_not_editable" },
  );
});

test("admin password plus email code creates an admin session", async () => {
  const adminPasswordHash = await hashPassword("Admin-Password-For-Test-123");
  const harness = createHarness({ adminPasswordHash });
  const admin = await harness.service.ensureAdmin();
  assert.equal(admin.role, "admin");
  const challenge = await harness.service.adminLoginStart({ email: harness.config.adminEmail, password: "Admin-Password-For-Test-123" });
  const code = harness.sent[harness.sent.length - 1].code;
  const result = await harness.service.adminLoginVerify({ challengeId: challenge.challengeId, code, request: {} });
  assert.equal(result.user.role, "admin");
  assert.equal(result.user.username, "Judit Ástríðr");
  const refreshed = await harness.service.refreshSession(result.refreshToken);
  assert.equal(refreshed.user.role, "admin");
});

test("administrator can set a user's password directly without sending email", async () => {
  const harness = createHarness();
  const registration = await harness.service.registerRequest({
    username: "Student",
    email: "student@ruc.edu.cn",
    password: "Old-Password-466743",
  });
  await harness.service.registerVerify({ challengeId: registration.challengeId, code: harness.sent.pop().code });
  const oldLogin = await harness.service.loginPassword({ email: "student@ruc.edu.cn", password: "Old-Password-466743" });
  const user = await harness.repo.findUserByEmailHash(emailHash("student@ruc.edu.cn", harness.config.challengeSecret));
  const sentBeforeReset = harness.sent.length;

  const result = await harness.service.adminResetPassword({
    admin: { id: "admin-1" },
    userId: user.id,
    password: "New-Password-466743",
    request: { ip: "127.0.0.1" },
  });

  assert.equal(result.status, "ok");
  assert.equal(result.revoked, 2);
  assert.equal(harness.sent.length, sentBeforeReset);
  assert.equal(result.user.passwordResetRequired, false);
  await assert.rejects(
    () => harness.service.loginPassword({ email: "student@ruc.edu.cn", password: "Old-Password-466743" }),
    { code: "invalid_credentials" },
  );
  const newLogin = await harness.service.loginPassword({ email: "student@ruc.edu.cn", password: "New-Password-466743" });
  assert.notEqual(newLogin.accessToken, oldLogin.accessToken);
  const audit = await harness.service.listAuditLogs({ limit: 1 });
  assert.equal(audit.rows[0].action, "admin_reset_password");
});
