"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

// This is a public endpoint, not a secret. It lets release builds remain
// usable when the build job does not provide a shell environment variable;
// deployments can still override it with RENMI_AUTH_API_URL.
const DEFAULT_AUTH_API_URL = "https://renmiao.org";

function isPlaceholderApiUrl(value) {
  try {
    const hostname = new URL(String(value || "")).hostname.toLowerCase();
    return hostname === "auth.example.invalid"
      || hostname === "auth.example.com"
      || hostname === "auth.your-domain.example"
      || hostname.endsWith(".example.invalid");
  } catch {
    return false;
  }
}

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
  defaultApiUrl = "",
} = {}) {
  const fromEnvironment = normalizeApiUrl(env.RENMI_AUTH_API_URL || env.CLAWD_AUTH_API_URL);
  if (fromEnvironment && !isPlaceholderApiUrl(fromEnvironment)) return fromEnvironment;

  const candidates = [];
  if (resourcesPath) candidates.push(path.join(resourcesPath, "renmi-auth-config.json"));
  if (userDataDir) candidates.push(path.join(userDataDir, "renmi-auth-config.json"));
  for (const filename of candidates) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filename, "utf8"));
      const resolved = normalizeApiUrl(parsed && (parsed.apiUrl || parsed.url));
      if (resolved && !isPlaceholderApiUrl(resolved)) return resolved;
    } catch {
      // A missing or malformed optional config keeps legacy local startup.
    }
  }
  const fallback = normalizeApiUrl(defaultApiUrl);
  return fallback && !isPlaceholderApiUrl(fallback) ? fallback : "";
}

module.exports = {
  DEFAULT_AUTH_API_URL,
  isPlaceholderApiUrl,
  normalizeApiUrl,
  resolveAuthApiUrl,
};
