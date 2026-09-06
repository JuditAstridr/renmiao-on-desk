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

test("registration allows duplicate usernames but rejects an email already bound to another user", async () => {
  const harness = createHarness();
  const first = await harness.service.registerRequest({
    username: "Same Display Name",
    email: "first.student@ruc.edu.cn",
    password: "First-Password-466743",
  });
  await harness.service.registerVerify({
    challengeId: first.challengeId,
    code: harness.sent.pop().code,
  });

  const second = await harness.service.registerRequest({
    username: "Same Display Name",
    email: "second.student@ruc.edu.cn",
    password: "Second-Password-466743",
  });
  const secondResult = await harness.service.registerVerify({
    challengeId: second.challengeId,
    code: harness.sent.pop().code,
  });
  assert.equal(secondResult.user.username, "Same Display Name");
  assert.equal(secondResult.user.email, "second.student@ruc.edu.cn");

  await assert.rejects(
    () => harness.service.registerRequest({
      username: "Another Name",
      email: "FIRST.STUDENT@RUC.EDU.CN",
      password: "Third-Password-466743",
    }),
    (error) => error.code === "email_unavailable" && error.status === 409,
  );
});

test("the repository also protects email uniqueness for direct writes", async () => {
  const harness = createHarness();
  const first = await harness.repo.insertUser({ id: "first", email_hash: "same-email-hash" });
  assert.equal(first.id, "first");
  const second = await harness.repo.insertUser({ id: "second", email_hash: "other-email-hash" });
  assert.equal(second.id, "second");
  await assert.rejects(
    () => harness.repo.insertUser({ id: "third", email_hash: "same-email-hash" }),
    (error) => error.code === "email_unique_violation",
  );
  await assert.rejects(
    () => harness.repo.updateUser("second", { email_hash: "same-email-hash" }),
    (error) => error.code === "email_unique_violation",
  );
  const unchanged = await harness.repo.getUserById("first");
  assert.equal(unchanged.email_hash, "same-email-hash");
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

test("an administrator cannot assign an email that belongs to another user", async () => {
  const harness = createHarness();
  const first = await harness.service.registerRequest({
    username: "First Student",
    email: "first.student@ruc.edu.cn",
    password: "First-Password-466743",
  });
  await harness.service.registerVerify({ challengeId: first.challengeId, code: harness.sent.pop().code });
  const second = await harness.service.registerRequest({
    username: "Second Student",
    email: "second.student@ruc.edu.cn",
    password: "Second-Password-466743",
  });
  await harness.service.registerVerify({ challengeId: second.challengeId, code: harness.sent.pop().code });
  const firstUser = await harness.repo.findUserByEmailHash(emailHash("first.student@ruc.edu.cn", harness.config.challengeSecret));

  await assert.rejects(
    () => harness.service.updateUser({
      admin: { id: "admin-1" },
      userId: firstUser.id,
      patch: { email: "SECOND.STUDENT@RUC.EDU.CN" },
      request: {},
    }),
    (error) => error.code === "email_taken" && error.status === 409,
  );
  const unchanged = await harness.repo.findUserByEmailHash(emailHash("first.student@ruc.edu.cn", harness.config.challengeSecret));
  assert.equal(unchanged.id, firstUser.id);
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
  assert.equal(admin.profile_state.study.points.total, 99999);
  assert.equal((await harness.service.getUserProfile(admin.id)).profile.study.points.total, 99999);
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

test("user profiles are cloud-scoped, admin-editable, and protected by a version token", async () => {
  const harness = createHarness();
  const registration = await harness.service.registerRequest({
    username: "Profile Student",
    email: "profile.student@ruc.edu.cn",
    password: "Profile-Password-466743",
  });
  await harness.service.registerVerify({
    challengeId: registration.challengeId,
    code: harness.sent.pop().code,
  });
  const user = await harness.repo.findUserByEmailHash(
    emailHash("profile.student@ruc.edu.cn", harness.config.challengeSecret),
  );

  const initial = await harness.service.getUserProfile(user.id);
  assert.equal(initial.profile.pet.themeId, "renmi");
  const profile = {
    version: 1,
    pet: {
      themeId: "cloudling",
      variantId: "calm",
      tintId: "mint",
      accessoryId: "none",
      holidayAccessoryEnabled: false,
      idleVisual: "idle.svg",
    },
    study: {
      tasks: [{
        id: "task-1",
        title: "Cloud-saved task",
        done: false,
        createdAt: 123,
        estimatedMinutes: 25,
        completedPomodoros: 1,
        deadline: null,
        category: "study",
        quadrant: 0,
        subtasks: [],
      }],
      pomodoro: { phase: "focus", running: true, taskId: "task-1", remainingSeconds: 900 },
      view: { sortBy: "deadline", groupBy: "category" },
      points: { total: 45, today: 15, streak: 2, bestStreak: 3, lastAwardDate: "2026-09-05" },
    },
  };
  const saved = await harness.service.updateUserProfile({
    user,
    profile,
    expectedUpdatedAt: initial.profileUpdatedAt,
  });
  assert.equal(saved.profile.pet.themeId, "cloudling");
  assert.equal(saved.profile.study.tasks[0].title, "Cloud-saved task");
  assert.equal(saved.profile.study.points.total, 45);

  const restored = await harness.service.getUserProfile(user.id);
  assert.deepEqual(restored.profile, saved.profile);

  await assert.rejects(
    () => harness.service.updateUserProfile({
      user,
      profile: { ...profile, pet: { ...profile.pet, themeId: "renmi" } },
      expectedUpdatedAt: "stale-profile-version",
    }),
    (error) => error.code === "profile_conflict"
      && error.status === 409
      && error.details.profile.pet.themeId === "cloudling",
  );

  const adminView = await harness.service.adminGetUserProfile({ userId: user.id });
  assert.deepEqual(adminView.profile, saved.profile);
  const adminSaved = await harness.service.adminUpdateUserProfile({
    admin: { id: "admin-1" },
    userId: user.id,
    profile: { ...saved.profile, study: { ...saved.profile.study, points: { total: 999 } } },
    expectedUpdatedAt: saved.profileUpdatedAt,
    request: { requestId: "profile-admin-edit" },
  });
  assert.equal(adminSaved.profile.study.points.total, 999);

  const listed = await harness.service.listUsers();
  assert.equal(listed.rows[0].profileSummary.themeId, "cloudling");
  assert.equal(listed.rows[0].profileSummary.pointsTotal, 999);
  const audit = await harness.service.listAuditLogs({ limit: 1 });
  assert.equal(audit.rows[0].action, "update_user_profile");
});
