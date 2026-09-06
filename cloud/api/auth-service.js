"use strict";

const crypto = require("node:crypto");

const {
  AuthError,
  assertEmail,
  assertUsername,
  assertPassword,
  normalizeEmail,
  normalizeUsername,
  usernameKey,
  randomToken,
  generateVerificationCode,
  digestChallenge,
  safeEqualText,
  hashPassword,
  verifyPassword,
  encryptText,
  decryptText,
  signAccessToken,
  verifyAccessToken,
  maskEmail,
} = require("./auth-core");
const {
  defaultAdminProfile,
  sanitizeProfile,
  profileFromRow,
  profileUpdatedAt,
  profileSummary,
} = require("./account-profile");

const ACTIVE_STATUSES = new Set(["active"]);
const MANAGED_STATUSES = new Set(["active", "pending", "suspended", "deleted"]);

function isoNow(now) {
  return new Date(now()).toISOString();
}

function emailHash(email, secret) {
  return crypto.createHmac("sha256", secret).update(normalizeEmail(email)).digest("hex");
}

function refreshHash(token, secret) {
  return crypto.createHmac("sha256", secret).update(String(token)).digest("hex");
}

function secondsUntil(value, nowMs) {
  return Math.floor((new Date(value).getTime() - nowMs) / 1000);
}

function isEmailUniqueViolation(error) {
  if (!error) return false;
  if (error.code === "email_unique_violation") return true;
  if (error.code !== "23505") return false;
  return /email_hash|users_email|email/i.test(
    `${error.message || ""} ${error.details || ""} ${error.hint || ""}`,
  );
}

function publicUser(row, config) {
  const email = decryptText(row.email_ciphertext, config.emailEncryptionSecret);
  return {
    id: row.id,
    username: row.username,
    email: email || maskEmail(email),
    emailMasked: maskEmail(email),
    role: row.role,
    status: row.status,
    emailVerified: !!row.email_verified_at,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    passwordResetRequired: row.password_reset_required === true,
    suspendedUntil: row.suspended_until || null,
    suspensionReason: row.suspension_reason || null,
  };
}

function adminUser(row, config) {
  return {
    ...publicUser(row, config),
    email: decryptText(row.email_ciphertext, config.emailEncryptionSecret) || "",
    profileUpdatedAt: profileUpdatedAt(row),
    profileSummary: profileSummary(row && row.profile_state),
  };
}

function createAuthService({ repo, emailer, config, now = Date.now, logger = console } = {}) {
  if (!repo || !emailer || !config) throw new TypeError("createAuthService requires repo, emailer and config");

  function requireActive(row) {
    if (!row || row.role !== "user" || !ACTIVE_STATUSES.has(row.status) || !row.email_verified_at) {
      throw new AuthError("账号或密码不正确", 401, "invalid_credentials");
    }
    if (row.suspended_until && new Date(row.suspended_until).getTime() > now()) {
      throw new AuthError("账号暂时无法使用", 403, "account_suspended");
    }
    return row;
  }

  function requireAdmin(row) {
    if (!row || row.role !== "admin" || row.status !== "active") {
      throw new AuthError("管理员凭证不正确", 401, "invalid_admin_credentials");
    }
    return row;
  }

  function requireProfileOwner(row) {
    if (row && row.role === "admin") return requireAdmin(row);
    return requireActive(row);
  }

  async function createChallenge({ userId = null, email, purpose, username = "" }) {
    const normalized = normalizeEmail(email);
    const hash = emailHash(normalized, config.challengeSecret);
    const code = generateVerificationCode();
    const createdAt = now();
    const expiresAt = new Date(createdAt + config.challengeTtlSeconds * 1000).toISOString();
    await repo.consumeActiveChallenges?.(hash, purpose, isoNow(now));
    const challenge = await repo.insertChallenge({
      user_id: userId,
      email_hash: hash,
      purpose,
      code_digest: digestChallenge(config.challengeSecret, { purpose, emailHash: hash, code }),
      expires_at: expiresAt,
      attempt_count: 0,
      max_attempts: config.maxOtpAttempts,
      consumed_at: null,
    });
    try {
      await emailer.sendVerificationCode({ to: normalized, code, purpose, username });
    } catch (error) {
      await repo.updateChallenge(challenge.id, { consumed_at: isoNow(now) }).catch(() => {});
      throw new AuthError("验证码邮件发送失败，请稍后重试", 503, "email_delivery_failed");
    }
    return {
      challengeId: challenge.id,
      expiresInSeconds: config.challengeTtlSeconds,
      email: maskEmail(normalized),
    };
  }

  async function verifyChallenge(challengeId, code, purpose) {
    if (typeof challengeId !== "string" || !challengeId || typeof code !== "string") {
      throw new AuthError("验证码无效或已过期", 400, "invalid_code");
    }
    const challenge = await repo.getChallenge(challengeId);
    if (!challenge || challenge.purpose !== purpose || challenge.consumed_at) {
      throw new AuthError("验证码无效或已过期", 400, "invalid_code");
    }
    if (new Date(challenge.expires_at).getTime() <= now()) {
      throw new AuthError("验证码已过期，请重新发送", 400, "code_expired");
    }
    if ((challenge.attempt_count || 0) >= (challenge.max_attempts || config.maxOtpAttempts)) {
      throw new AuthError("验证码尝试次数过多，请重新发送", 429, "code_locked");
    }
    const digest = digestChallenge(config.challengeSecret, {
      purpose,
      emailHash: challenge.email_hash,
      code: code.trim(),
    });
    if (!safeEqualText(digest, challenge.code_digest)) {
      await repo.updateChallenge(challenge.id, { attempt_count: (challenge.attempt_count || 0) + 1 });
      throw new AuthError("验证码错误", 400, "invalid_code");
    }
    await repo.updateChallenge(challenge.id, { consumed_at: isoNow(now) });
    return challenge;
  }

  async function issueSession(user, request = {}) {
    const refreshToken = randomToken(32);
    const createdAt = now();
    const session = await repo.insertSession({
      user_id: user.id,
      refresh_token_hash: refreshHash(refreshToken, config.sessionSecret),
      device_name: String(request.deviceName || "Renmi Desktop").slice(0, 120),
      ip: String(request.ip || "").slice(0, 80),
      user_agent: String(request.userAgent || "").slice(0, 300),
      created_at: isoNow(() => createdAt),
      last_seen_at: isoNow(() => createdAt),
      expires_at: new Date(createdAt + config.refreshTokenTtlSeconds * 1000).toISOString(),
      revoked_at: null,
    });
    const accessToken = signAccessToken({
      sub: user.id,
      sid: session.id,
      role: user.role,
      exp: Math.floor(createdAt / 1000) + config.accessTokenTtlSeconds,
      iat: Math.floor(createdAt / 1000),
    }, config.sessionSecret);
    return {
      accessToken,
      refreshToken,
      expiresInSeconds: config.accessTokenTtlSeconds,
      user: publicUser(user, config),
    };
  }

  async function findUserByEmail(email, { user = true } = {}) {
    const normalized = assertEmail(email, { user });
    const hash = emailHash(normalized, config.challengeSecret);
    return { normalized, hash, row: await repo.findUserByEmailHash(hash) };
  }

  async function registerRequest({ username, email, password }) {
    const displayName = assertUsername(username);
    const normalizedUsername = usernameKey(displayName);
    const emailInfo = await findUserByEmail(email, { user: true });
    assertPassword(password);
    let user = emailInfo.row;
    const passwordHash = await hashPassword(password);
    if (user) {
      if (user.role !== "user" || user.status !== "pending") {
        throw new AuthError("该邮箱已注册或不可用", 409, "email_unavailable");
      }
      user = await repo.updateUser(user.id, {
        username: displayName,
        username_normalized: normalizedUsername,
        password_hash: passwordHash,
      });
    } else {
      try {
        user = await repo.insertUser({
          username: displayName,
          username_normalized: normalizedUsername,
          email_ciphertext: encryptText(emailInfo.normalized, config.emailEncryptionSecret),
          email_hash: emailInfo.hash,
          password_hash: passwordHash,
          role: "user",
          status: "pending",
          email_verified_at: null,
          last_login_at: null,
          suspended_until: null,
          suspension_reason: null,
          deleted_at: null,
        });
      } catch (error) {
        if (isEmailUniqueViolation(error)) {
          throw new AuthError("该邮箱已被其他用户绑定", 409, "email_taken");
        }
        throw error;
      }
    }
    return createChallenge({ userId: user.id, email: emailInfo.normalized, purpose: "register", username: displayName });
  }

  async function registerVerify({ challengeId, code, request }) {
    const challenge = await verifyChallenge(challengeId, code, "register");
    const user = await repo.getUserById(challenge.user_id);
    if (!user || user.status !== "pending") throw new AuthError("注册信息已失效，请重新注册", 400, "registration_expired");
    const verified = await repo.updateUser(user.id, {
      status: "active",
      email_verified_at: isoNow(now),
    });
    return issueSession(verified, request);
  }

  async function loginPassword({ email, password, request }) {
    const info = await findUserByEmail(email, { user: true });
    const user = requireActive(info.row);
    if (user.password_reset_required) {
      throw new AuthError("请先使用邮箱验证码重置密码", 403, "password_reset_required");
    }
    if (!(await verifyPassword(password, user.password_hash))) {
      throw new AuthError("账号或密码不正确", 401, "invalid_credentials");
    }
    const updated = await repo.updateUser(user.id, { last_login_at: isoNow(now) });
    return issueSession(updated || user, request);
  }

  async function loginCodeRequest({ email }) {
    const info = await findUserByEmail(email, { user: true });
    const user = requireActive(info.row);
    if (user.password_reset_required) {
      throw new AuthError("请先使用邮箱验证码重置密码", 403, "password_reset_required");
    }
    return createChallenge({ userId: user.id, email: info.normalized, purpose: "login", username: user.username });
  }

  async function loginCodeVerify({ challengeId, code, request }) {
    const challenge = await verifyChallenge(challengeId, code, "login");
    const user = requireActive(await repo.getUserById(challenge.user_id));
    const updated = await repo.updateUser(user.id, { last_login_at: isoNow(now) });
    return issueSession(updated || user, request);
  }

  async function resetPasswordRequest({ email }) {
    const info = await findUserByEmail(email, { user: true });
    const user = requireActive(info.row);
    return createChallenge({ userId: user.id, email: info.normalized, purpose: "reset_password", username: user.username });
  }

  async function resetPassword({ challengeId, code, password }) {
    assertPassword(password);
    const challenge = await verifyChallenge(challengeId, code, "reset_password");
    const user = requireActive(await repo.getUserById(challenge.user_id));
    const updated = await repo.updateUser(user.id, { password_hash: await hashPassword(password), password_reset_required: false });
    await repo.revokeUserSessions(user.id);
    return issueSession(updated || user);
  }

  async function refreshSession(refreshToken, request = {}) {
    if (!refreshToken) throw new AuthError("登录已过期，请重新登录", 401, "session_expired");
    const session = await repo.getSessionByRefreshHash(refreshHash(refreshToken, config.sessionSecret));
    if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= now()) {
      throw new AuthError("登录已过期，请重新登录", 401, "session_expired");
    }
    const sessionUser = await repo.getUserById(session.user_id);
    const user = sessionUser && sessionUser.role === "admin" ? requireAdmin(sessionUser) : requireActive(sessionUser);
    const nextRefresh = randomToken(32);
    await repo.updateSession(session.id, {
      refresh_token_hash: refreshHash(nextRefresh, config.sessionSecret),
      last_seen_at: isoNow(now),
      ip: String(request.ip || session.ip || "").slice(0, 80),
      user_agent: String(request.userAgent || session.user_agent || "").slice(0, 300),
    });
    const accessToken = signAccessToken({
      sub: user.id,
      sid: session.id,
      role: user.role,
      exp: Math.floor(now() / 1000) + config.accessTokenTtlSeconds,
      iat: Math.floor(now() / 1000),
    }, config.sessionSecret);
    return { accessToken, refreshToken: nextRefresh, expiresInSeconds: config.accessTokenTtlSeconds, user: publicUser(user, config) };
  }

  async function logout(refreshToken) {
    if (!refreshToken) return { status: "ok" };
    const session = await repo.getSessionByRefreshHash(refreshHash(refreshToken, config.sessionSecret));
    if (session) await repo.revokeSession(session.id);
    return { status: "ok" };
  }

  async function authenticateAccessToken(token) {
    const payload = verifyAccessToken(token, config.sessionSecret, Math.floor(now() / 1000));
    if (!payload || typeof payload.sid !== "string" || !payload.sid) {
      throw new AuthError("登录已过期，请重新登录", 401, "access_token_expired");
    }
    const session = await repo.getSessionById(payload.sid);
    if (!session || session.user_id !== payload.sub || session.revoked_at
      || new Date(session.expires_at).getTime() <= now()) {
      throw new AuthError("登录已过期，请重新登录", 401, "session_expired");
    }
    const user = await repo.getUserById(payload.sub);
    if (payload.role === "admin") return requireAdmin(user);
    return requireActive(user);
  }

  async function adminLoginStart({ email, password }) {
    const info = await findUserByEmail(email, { user: false });
    if (info.normalized !== config.adminEmail) {
      throw new AuthError("管理员凭证不正确", 401, "invalid_admin_credentials");
    }
    const admin = requireAdmin(info.row);
    if (!(await verifyPassword(password, admin.password_hash))) {
      throw new AuthError("管理员凭证不正确", 401, "invalid_admin_credentials");
    }
    return createChallenge({ userId: admin.id, email: info.normalized, purpose: "admin_login", username: admin.username });
  }

  async function adminLoginVerify({ challengeId, code, request }) {
    const challenge = await verifyChallenge(challengeId, code, "admin_login");
    const admin = requireAdmin(await repo.getUserById(challenge.user_id));
    await repo.updateUser(admin.id, { last_login_at: isoNow(now) });
    return issueSession(admin, request);
  }

  async function verifyEmailChange({ challengeId, email, code }) {
    let resolvedChallengeId = challengeId;
    if (!resolvedChallengeId) {
      const normalized = assertEmail(email, { user: true });
      const hash = emailHash(normalized, config.challengeSecret);
      const active = await repo.findActiveChallengeByEmailHash(hash, "change_email");
      resolvedChallengeId = active && active.id;
    }
    const challenge = await verifyChallenge(resolvedChallengeId, code, "change_email");
    const user = await repo.getUserById(challenge.user_id);
    if (!user || user.role !== "user" || user.status !== "pending" || user.email_hash !== challenge.email_hash) {
      throw new AuthError("邮箱验证信息已失效，请联系管理员", 400, "email_change_expired");
    }
    const updated = await repo.updateUser(user.id, {
      status: "active",
      email_verified_at: isoNow(now),
    });
    return { status: "ok", user: publicUser(updated, config) };
  }

  async function adminResetPassword({ admin, userId, password, request = {} }) {
    const user = await repo.getUserById(userId);
    if (!user || user.role !== "user") throw new AuthError("用户不存在", 404, "user_not_found");
    assertPassword(password);
    const updated = await repo.updateUser(user.id, {
      password_hash: await hashPassword(password),
      password_reset_required: false,
    });
    const revoked = await repo.revokeUserSessions(user.id);
    await repo.insertAuditLog({
      admin_id: admin.id,
      action: "admin_reset_password",
      target_user_id: user.id,
      metadata: { revokedSessions: revoked },
      ip: request.ip || "",
    });
    return { status: "ok", revoked, user: adminUser(updated, config) };
  }

  function profileResponse(row) {
    return {
      profile: profileFromRow(row),
      profileUpdatedAt: profileUpdatedAt(row),
    };
  }

  async function getUserProfile(userId) {
    const row = await repo.getUserById(userId);
    if (!row || !["user", "admin"].includes(row.role)) {
      throw new AuthError("用户不存在", 404, "user_not_found");
    }
    requireProfileOwner(row);
    return profileResponse(row);
  }

  function profileConflict(row) {
    return new AuthError(
      "账号资料已在其他位置更新，请重新加载后再保存",
      409,
      "profile_conflict",
      row ? profileResponse(row) : undefined,
    );
  }

  async function saveUserProfile({ userId, profile, expectedUpdatedAt, request = {}, admin = null }) {
    const current = await repo.getUserById(userId);
    if (!current || !["user", "admin"].includes(current.role)) {
      throw new AuthError("用户不存在", 404, "user_not_found");
    }
    if (!admin) requireProfileOwner(current);
    const nextProfile = sanitizeProfile(profile);
    const expected = typeof expectedUpdatedAt === "string" ? expectedUpdatedAt.trim() : "";
    const updated = await repo.updateUserProfile(userId, nextProfile, expected || undefined);
    if (!updated) {
      const latest = await repo.getUserById(userId);
      if (latest) throw profileConflict(latest);
      throw new AuthError("用户不存在", 404, "user_not_found");
    }
    if (admin) {
      await repo.insertAuditLog({
        admin_id: admin.id,
        action: "update_user_profile",
        target_user_id: userId,
        metadata: {
          requestId: request.requestId || null,
          fields: ["pet", "study"],
        },
        ip: request.ip || "",
      });
    }
    return profileResponse(updated);
  }

  async function updateUserProfile({ user, profile, expectedUpdatedAt, request = {} }) {
    return saveUserProfile({
      userId: user.id,
      profile,
      expectedUpdatedAt,
      request,
    });
  }

  async function adminGetUserProfile({ userId }) {
    const row = await repo.getUserById(userId);
    if (!row || row.role !== "user") throw new AuthError("用户不存在", 404, "user_not_found");
    return profileResponse(row);
  }

  async function adminUpdateUserProfile({ admin, userId, profile, expectedUpdatedAt, request = {} }) {
    return saveUserProfile({
      admin,
      userId,
      profile,
      expectedUpdatedAt,
      request,
    });
  }

  async function ensureAdmin() {
    if (!config.adminPasswordHash) {
      logger.warn("Renmi auth: RENMI_ADMIN_PASSWORD_HASH is not configured; admin login is disabled");
      return null;
    }
    const info = await findUserByEmail(config.adminEmail, { user: false });
    if (info.row) {
      if (info.row.role !== "admin") throw new Error("Configured admin email belongs to a non-admin user");
      const patch = {};
      const username = normalizeUsername(config.adminUsername);
      if (info.row.username !== username || info.row.username_normalized !== usernameKey(username)) {
        patch.username = username;
        patch.username_normalized = usernameKey(username);
      }
      const passwordChanged = info.row.password_hash !== config.adminPasswordHash;
      if (passwordChanged) {
        patch.password_hash = config.adminPasswordHash;
        patch.password_reset_required = false;
      }
      if (info.row.status !== "active" || !info.row.email_verified_at) {
        patch.status = "active";
        patch.email_verified_at = info.row.email_verified_at || isoNow(now);
      }
      const existingProfile = info.row.profile_state;
      if (!existingProfile || typeof existingProfile !== "object" || Array.isArray(existingProfile)
        || !existingProfile.pet || !existingProfile.study) {
        patch.profile_state = defaultAdminProfile();
      }
      const updated = Object.keys(patch).length ? await repo.updateUser(info.row.id, patch) : info.row;
      if (passwordChanged) await repo.revokeUserSessions(info.row.id);
      return updated;
    }
    return repo.insertUser({
      username: normalizeUsername(config.adminUsername),
      username_normalized: usernameKey(config.adminUsername),
      email_ciphertext: encryptText(config.adminEmail, config.emailEncryptionSecret),
      email_hash: info.hash,
      password_hash: config.adminPasswordHash,
      role: "admin",
      status: "active",
      email_verified_at: isoNow(now),
      last_login_at: null,
      suspended_until: null,
      suspension_reason: null,
      deleted_at: null,
      profile_state: defaultAdminProfile(),
    });
  }

  async function listUsers({ query = "", status = "", limit = 50, offset = 0 } = {}) {
    let queryEmailHash = "";
    const normalizedQuery = String(query || "").trim();
    if (normalizedQuery.includes("@")) {
      try { queryEmailHash = emailHash(assertEmail(normalizedQuery, { user: false }), config.challengeSecret); } catch {}
    }
    const result = await repo.listUsers({
      query: queryEmailHash ? "" : normalizedQuery,
      queryEmailHash,
      status: MANAGED_STATUSES.has(status) ? status : "",
      limit: Math.min(Math.max(Number(limit) || 50, 1), 100),
      offset: Math.max(Number(offset) || 0, 0),
    });
    return { rows: result.rows.filter((row) => row.role === "user").map((row) => adminUser(row, config)), total: result.total };
  }

  async function updateUser({ admin, userId, patch, request }) {
    const user = await repo.getUserById(userId);
    if (!user || user.role !== "user") throw new AuthError("用户不存在", 404, "user_not_found");
    const next = {};
    if (patch && Object.prototype.hasOwnProperty.call(patch, "username")) {
      const displayName = assertUsername(patch.username);
      const normalized = usernameKey(displayName);
      next.username = displayName;
      next.username_normalized = normalized;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "status")) {
      if (!MANAGED_STATUSES.has(patch.status) || patch.status === "pending") {
        throw new AuthError("不支持的账户状态", 400, "invalid_status");
      }
      next.status = patch.status;
      next.suspension_reason = patch.status === "suspended" ? String(patch.suspensionReason || "管理员暂停").slice(0, 500) : null;
      next.suspended_until = patch.status === "suspended" && patch.suspendedUntil ? new Date(patch.suspendedUntil).toISOString() : null;
      if (patch.status === "deleted") next.deleted_at = isoNow(now);
      if (patch.status === "active") next.deleted_at = null;
    }
    if (patch && Object.prototype.hasOwnProperty.call(patch, "email")) {
      if (user.status === "suspended" || user.status === "deleted") {
        throw new AuthError("请先恢复账户后再修改绑定邮箱", 409, "account_not_editable");
      }
      const normalizedEmail = assertEmail(patch.email, { user: true });
      const nextHash = emailHash(normalizedEmail, config.challengeSecret);
      if (nextHash === user.email_hash) {
        // An unchanged address should not lock the user behind a new
        // verification challenge.
      } else {
        const collision = await repo.findUserByEmailHash(nextHash);
        if (collision && collision.id !== user.id) throw new AuthError("邮箱已被使用", 409, "email_taken");
        next.email_ciphertext = encryptText(normalizedEmail, config.emailEncryptionSecret);
        next.email_hash = nextHash;
        next.email_verified_at = null;
        next.status = "pending";
      }
    }
    let updated;
    try {
      updated = await repo.updateUser(user.id, next);
    } catch (error) {
      if (isEmailUniqueViolation(error)) {
        throw new AuthError("该邮箱已被其他用户绑定", 409, "email_taken");
      }
      throw error;
    }
    if (next.status === "suspended" || next.status === "deleted" || next.email_hash) await repo.revokeUserSessions(user.id);
    let emailVerification = null;
    if (next.email_hash) {
      emailVerification = await createChallenge({ userId: user.id, email: patch.email, purpose: "change_email", username: updated.username });
    }
    await repo.insertAuditLog({
      admin_id: admin.id,
      action: next.status === "suspended" ? "suspend_user" : next.status === "deleted" ? "delete_user" : "update_user",
      target_user_id: user.id,
      metadata: { fields: Object.keys(next), requestId: request.requestId || null },
      ip: request.ip || "",
    });
    return { user: adminUser(updated, config), emailVerification };
  }

  async function revokeUserSessions({ admin, userId, request }) {
    const user = await repo.getUserById(userId);
    if (!user || user.role !== "user") throw new AuthError("用户不存在", 404, "user_not_found");
    const count = await repo.revokeUserSessions(user.id);
    await repo.insertAuditLog({
      admin_id: admin.id,
      action: "revoke_user_sessions",
      target_user_id: user.id,
      metadata: { count },
      ip: request.ip || "",
    });
    return { status: "ok", revoked: count };
  }

  async function listAuditLogs({ limit = 100, offset = 0 } = {}) {
    const result = await repo.listAuditLogs({
      limit: Math.min(Math.max(Number(limit) || 100, 1), 200),
      offset: Math.max(Number(offset) || 0, 0),
    });
    return result;
  }

  return {
    ensureAdmin,
    registerRequest,
    registerVerify,
    loginPassword,
    loginCodeRequest,
    loginCodeVerify,
    resetPasswordRequest,
    resetPassword,
    refreshSession,
    logout,
    authenticateAccessToken,
    adminLoginStart,
    adminLoginVerify,
    verifyEmailChange,
    adminResetPassword,
    getUserProfile,
    updateUserProfile,
    adminGetUserProfile,
    adminUpdateUserProfile,
    listAuditLogs,
    listUsers,
    updateUser,
    revokeUserSessions,
    publicUser: (row) => publicUser(row, config),
    adminUser: (row) => adminUser(row, config),
    secondsUntil: (value) => secondsUntil(value, now()),
  };
}

module.exports = { createAuthService, emailHash, refreshHash };
