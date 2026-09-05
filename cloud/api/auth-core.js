"use strict";

const crypto = require("node:crypto");

const USER_EMAIL_RE = /^[^\s@]+@ruc\.edu\.cn$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_MIN = 2;
const USERNAME_MAX = 32;
const PASSWORD_MIN = 10;
const OTP_LENGTH = 6;
const OTP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

class AuthError extends Error {
  constructor(message, status = 400, code = "bad_request", details = undefined) {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeEmail(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase();
}

function assertEmail(value, { user = true } = {}) {
  const email = normalizeEmail(value);
  if (!email || !EMAIL_RE.test(email)) {
    throw new AuthError("请输入有效邮箱地址", 400, "invalid_email");
  }
  if (user && !USER_EMAIL_RE.test(email)) {
    throw new AuthError("普通用户必须使用 @ruc.edu.cn 邮箱", 400, "ruc_email_required");
  }
  return email;
}

function normalizeUsername(value) {
  if (typeof value !== "string") return "";
  return value.trim().normalize("NFKC");
}

function usernameKey(value) {
  return normalizeUsername(value).toLocaleLowerCase("und");
}

function assertUsername(value) {
  const username = normalizeUsername(value);
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    throw new AuthError(`用户名长度必须为 ${USERNAME_MIN}-${USERNAME_MAX} 个字符`, 400, "invalid_username");
  }
  if (/[\u0000-\u001f\u007f]/.test(username)) {
    throw new AuthError("用户名包含不支持的字符", 400, "invalid_username");
  }
  return username;
}

function assertPassword(value) {
  if (typeof value !== "string" || value.length < PASSWORD_MIN || value.length > 256) {
    throw new AuthError(`密码长度必须为 ${PASSWORD_MIN}-256 个字符`, 400, "invalid_password");
  }
  return value;
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function generateVerificationCode() {
  for (;;) {
    let code = "";
    for (let index = 0; index < OTP_LENGTH; index += 1) {
      code += OTP_ALPHABET[crypto.randomInt(OTP_ALPHABET.length)];
    }
    if (/[A-Z]/.test(code) && /[a-z]/.test(code) && /[0-9]/.test(code)) return code;
  }
}

function digestChallenge(secret, { purpose, emailHash, code }) {
  return crypto.createHmac("sha256", secret)
    .update(`${purpose}:${emailHash}:${String(code).trim()}`)
    .digest("hex");
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function hashPassword(password) {
  assertPassword(password);
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, {
      N: 1 << 15,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derived) => {
      if (error) return reject(error);
      resolve(`scrypt$N=32768$r=8$p=1$${salt.toString("base64url")}$${derived.toString("base64url")}`);
    });
  });
}

function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return Promise.resolve(false);
  const parts = encoded.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return Promise.resolve(false);
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (!salt.length || !expected.length) return Promise.resolve(false);
  return new Promise((resolve) => {
    crypto.scrypt(password, salt, expected.length, {
      N: 1 << 15,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derived) => {
      resolve(!error && derived.length === expected.length && crypto.timingSafeEqual(derived, expected));
    });
  });
}

function keyFromSecret(secret) {
  return crypto.createHash("sha256").update(String(secret || "")).digest();
}

function encryptText(value, secret) {
  const key = keyFromSecret(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url")).join(".");
}

function decryptText(value, secret) {
  const [ivRaw, tagRaw, ciphertextRaw] = String(value || "").split(".");
  if (!ivRaw || !tagRaw || !ciphertextRaw) return "";
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromSecret(secret), Buffer.from(ivRaw, "base64url"));
    decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBase64urlJson(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function signAccessToken(payload, secret) {
  const header = base64urlJson({ alg: "HS256", typ: "JWT" });
  const body = base64urlJson(payload);
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyAccessToken(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const expected = crypto.createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (!safeEqualText(expected, parts[2])) return null;
  const payload = parseBase64urlJson(parts[1]);
  if (!payload || payload.exp <= nowSeconds || typeof payload.sub !== "string") return null;
  return payload;
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const visible = local.length <= 2 ? local[0] : local.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, local.length - visible.length))}${email.slice(at)}`;
}

module.exports = {
  AuthError,
  EMAIL_RE,
  USER_EMAIL_RE,
  PASSWORD_MIN,
  normalizeEmail,
  assertEmail,
  normalizeUsername,
  usernameKey,
  assertUsername,
  assertPassword,
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
};
