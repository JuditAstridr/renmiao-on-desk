"use strict";

const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_ADMIN_EMAIL = "judit.astridr@gmail.com";
const DEFAULT_ADMIN_USERNAME = "Judit Ástríðr";

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createConfig(env = process.env) {
  const devMode = env.AUTH_DEV_MODE === "1";
  const sessionSecret = env.AUTH_SESSION_SECRET || (devMode ? "renmi-local-development-session-secret" : "");
  const emailEncryptionSecret = env.AUTH_EMAIL_ENCRYPTION_SECRET || sessionSecret;
  const challengeSecret = env.AUTH_CHALLENGE_SECRET || sessionSecret;
  if (!sessionSecret || !emailEncryptionSecret || !challengeSecret) {
    throw new Error("AUTH_SESSION_SECRET, AUTH_EMAIL_ENCRYPTION_SECRET and AUTH_CHALLENGE_SECRET are required");
  }
  if (!devMode && (!env.AUTH_SESSION_SECRET || !env.AUTH_EMAIL_ENCRYPTION_SECRET || !env.AUTH_CHALLENGE_SECRET)) {
    throw new Error("Cloud mode requires three separate AUTH_* secrets");
  }

  return Object.freeze({
    host: env.AUTH_HOST || (devMode ? "127.0.0.1" : "0.0.0.0"),
    port: positiveInt(env.AUTH_PORT, 8787),
    devMode,
    allowedOrigins: String(env.AUTH_ALLOWED_ORIGINS || "http://localhost:8787")
      .split(",").map((value) => value.trim()).filter(Boolean),
    trustProxy: env.AUTH_TRUST_PROXY === "1",
    sessionSecret,
    challengeSecret,
    emailEncryptionSecret,
    adminEmail: String(env.RENMI_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase(),
    adminUsername: env.RENMI_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME,
    adminPasswordHash: env.RENMI_ADMIN_PASSWORD_HASH || "",
    devDataPath: env.RENMI_AUTH_DATA_PATH || path.join(os.homedir(), ".renmiao", "auth-dev.json"),
    supabaseUrl: env.SUPABASE_URL || "",
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY || "",
    resendApiKey: env.RESEND_API_KEY || "",
    emailFrom: env.AUTH_EMAIL_FROM || "Renmi on Desk <no-reply@example.com>",
    accessTokenTtlSeconds: positiveInt(env.AUTH_ACCESS_TTL_SECONDS, 15 * 60),
    refreshTokenTtlSeconds: positiveInt(env.AUTH_REFRESH_TTL_SECONDS, 30 * 24 * 60 * 60),
    challengeTtlSeconds: positiveInt(env.AUTH_CHALLENGE_TTL_SECONDS, 10 * 60),
    otpResendSeconds: positiveInt(env.AUTH_OTP_RESEND_SECONDS, 60),
    maxOtpAttempts: positiveInt(env.AUTH_MAX_OTP_ATTEMPTS, 5),
    emailKeyId: env.AUTH_EMAIL_KEY_ID || "v1",
    encryptionKeyFingerprint: crypto.createHash("sha256").update(emailEncryptionSecret).digest("hex").slice(0, 12),
  });
}

module.exports = {
  DEFAULT_ADMIN_EMAIL,
  DEFAULT_ADMIN_USERNAME,
  createConfig,
};
