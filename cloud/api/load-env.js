"use strict";

const fs = require("node:fs");
const path = require("node:path");

function parseEnv(contents) {
  const values = {};
  for (const rawLine of String(contents || "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[key] = value;
  }
  return values;
}

function loadEnv({ cwd = path.resolve(__dirname, "../.."), fsImpl = fs } = {}) {
  const loaded = {};
  const fileValues = {};
  // cloud/.env wins over a repository-root .env, while process environment
  // variables always remain authoritative.
  const filenames = [path.join(cwd, ".env"), path.join(cwd, "cloud", ".env")];
  for (const filename of filenames) {
    let parsed;
    try { parsed = parseEnv(fsImpl.readFileSync(filename, "utf8")); } catch { continue; }
    Object.assign(fileValues, parsed);
  }
  for (const [key, value] of Object.entries(fileValues)) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = value;
    loaded[key] = value;
  }
  return loaded;
}

module.exports = { loadEnv, parseEnv };
