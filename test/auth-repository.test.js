"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createFileRepository } = require("../cloud/api/file-repository");

test("file auth repository keeps accounts and audit records across restarts", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "renmi-auth-persist-"));
  const filePath = path.join(directory, "auth-dev.json");
  const first = createFileRepository({ filePath });
  const user = await first.insertUser({
    username: "Student",
    username_normalized: "student",
    email_ciphertext: "encrypted-email",
    email_hash: "email-hash",
    password_hash: "scrypt$test",
    role: "user",
    status: "active",
    email_verified_at: new Date().toISOString(),
  });
  await first.insertAuditLog({ action: "create_user", target_user_id: user.id });
  await first.close();

  const second = createFileRepository({ filePath });
  const restored = await second.getUserById(user.id);
  const listed = await second.listUsers({ limit: 50, offset: 0 });
  const logs = await second.listAuditLogs({ limit: 50, offset: 0 });
  assert.equal(restored.username, "Student");
  assert.equal(listed.total, 1);
  assert.equal(listed.rows[0].id, user.id);
  assert.equal(logs.total, 1);
  assert.equal(logs.rows[0].target_user_id, user.id);
  await second.close();

  const mode = fs.statSync(filePath).mode & 0o777;
  assert.equal(mode, 0o600);
});
