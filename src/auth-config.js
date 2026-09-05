"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

function normalizeApiUrl(value) {
  const candidate = String(value || "").trim().replace(/\/+$/, "");
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function resolveAuthApiUrl({
  env = process.env,
  fs = defaultFs,
  path = defaultPath,
  resourcesPath = process.resourcesPath,
  userDataDir = "",
} = {}) {
  const fromEnvironment = normalizeApiUrl(env.RENMI_AUTH_API_URL || env.CLAWD_AUTH_API_URL);
  if (fromEnvironment) return fromEnvironment;

  const candidates = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, "renmi-auth-config.json"));
  if (userDataDir) candidates.push(path.join(userDataDir, "renmi-auth-config.json"));
  for (const filename of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
      const resolved = normalizeApiUrl(parsed && (parsed.apiUrl || parsed.url));
      if (resolved) return resolved;
    } catch {
      // A missing or malformed optional config keeps legacy local startup.
    }
  }
  return "";
}

module.exports = { normalizeApiUrl, resolveAuthApiUrl };
