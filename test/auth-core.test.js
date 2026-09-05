"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  AuthError,
  assertEmail,
  assertUsername,
  generateVerificationCode,
  hashPassword,
  verifyPassword,
  encryptText,
  decryptText,
  signAccessToken,
  verifyAccessToken,
} = require("../cloud/api/auth-core");

test("RUC email validation accepts users and rejects other domains", () => {
  assert.equal(assertEmail(" Student@RUC.EDU.CN "), "student@ruc.edu.cn");
  assert.throws(() => assertEmail("student@gmail.com"), (error) => error instanceof AuthError && error.code === "ruc_email_required");
  assert.equal(assertEmail("judit.astridr@gmail.com", { user: false }), "judit.astridr@gmail.com");
});

test("verification codes are six mixed-case alphanumeric characters", () => {
  const code = generateVerificationCode();
  assert.match(code, /^[A-Za-z0-9]{6}$/);
  assert.match(code, /[A-Z]/);
  assert.match(code, /[a-z]/);
  assert.match(code, /[0-9]/);
});

test("password hashes and encrypted email values do not round-trip as plaintext", async () => {
  const password = "Correct-Horse-466743";
  const encoded = await hashPassword(password);
  assert.notEqual(encoded, password);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("wrong-password", encoded), false);
  const encrypted = encryptText("student@ruc.edu.cn", "email-secret");
  assert.notEqual(encrypted, "student@ruc.edu.cn");
  assert.equal(decryptText(encrypted, "email-secret"), "student@ruc.edu.cn");
  assert.equal(decryptText(encrypted, "wrong-secret"), "");
});

test("access tokens reject tampering and expire", () => {
  const token = signAccessToken({ sub: "user-1", sid: "session-1", role: "user", iat: 100, exp: 200 }, "secret");
  assert.equal(verifyAccessToken(token, "secret", 150).sub, "user-1");
  assert.equal(verifyAccessToken(`${token}x`, "secret", 150), null);
  assert.equal(verifyAccessToken(token, "secret", 200), null);
});

test("username validation preserves unicode display names", () => {
  assert.equal(assertUsername(" Judit Ástríðr "), "Judit Ástríðr");
  assert.throws(() => assertUsername("a"), /长度/);
});
