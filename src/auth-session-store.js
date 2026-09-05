"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

function createAuthSessionStore({ filePath, safeStorage, fs = defaultFs, path = defaultPath } = {}) {
  if (!filePath) throw new TypeError("createAuthSessionStore requires filePath");

  function canEncrypt() {
    try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  function load() {
    if (!canEncrypt()) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed.refreshTokenEncrypted !== "string") return null;
      const refreshToken = safeStorage.decryptString(Buffer.from(parsed.refreshTokenEncrypted, "base64"));
      if (!refreshToken) return null;
      return { refreshToken, user: parsed.user || null, savedAt: parsed.savedAt || null };
    } catch { return null; }
  }

  function save({ refreshToken, user }) {
    if (!refreshToken || !canEncrypt()) return false;
    const directory = path.dirname(filePath);
    const tempPath = `${filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true });
      const encrypted = safeStorage.encryptString(String(refreshToken)).toString("base64");
      fs.writeFileSync(tempPath, JSON.stringify({
        refreshTokenEncrypted: encrypted,
        user: user || null,
        savedAt: new Date().toISOString(),
      }) + "\n", { encoding: "utf8", mode: 0o600 });
      fs.renameSync(tempPath, filePath);
      return true;
    } catch {
      try { fs.unlinkSync(tempPath); } catch {}
      return false;
    }
  }

  function clear() {
    try { fs.unlinkSync(filePath); } catch (error) { if (error.code !== "ENOENT") return false; }
    return true;
  }

  return { load, save, clear, canEncrypt };
}

module.exports = { createAuthSessionStore };
