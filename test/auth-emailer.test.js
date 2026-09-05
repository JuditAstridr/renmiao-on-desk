"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createEmailer } = require("../cloud/api/emailer");

test("email delivery never falls back to printing verification codes", async () => {
  let fetchCalled = false;
  const emailer = createEmailer({ emailFrom: "renmiao <noreply@example.org>" }, {
    fetchImpl: async () => { fetchCalled = true; return { ok: true, text: async () => "" }; },
  });
  await assert.rejects(
    () => emailer.sendVerificationCode({ to: "student@ruc.edu.cn", code: "aB3xY9", purpose: "login" }),
    /RESEND_API_KEY is not configured/,
  );
  assert.equal(fetchCalled, false);
});

test("configured email delivery calls Resend with the verification message", async () => {
  let request;
  const emailer = createEmailer({
    resendApiKey: "re_test_key",
    emailFrom: "renmiao <noreply@example.org>",
  }, {
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, text: async () => "" };
    },
  });
  const result = await emailer.sendVerificationCode({
    to: "judit.astridr@gmail.com",
    code: "aB3xY9",
    purpose: "admin_login",
    username: "Judit Ástríðr",
  });
  const body = JSON.parse(request.options.body);
  assert.equal(result.delivered, true);
  assert.equal(request.url, "https://api.resend.com/emails");
  assert.equal(request.options.headers.Authorization, "Bearer re_test_key");
  assert.deepEqual(body.to, ["judit.astridr@gmail.com"]);
  assert.equal(body.subject, "renmiao｜管理员登录验证码");
  assert.match(body.text, /aB3xY9/);
  assert.match(body.html, /Judit Ástríðr/);
});
