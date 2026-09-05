"use strict";

const defaultFs = require("node:fs");
const defaultPath = require("node:path");

const { createMemoryRepository } = require("./memory-repository");

const FORMAT_VERSION = 1;
const MUTATING_METHODS = new Set([
  "insertUser",
  "updateUser",
  "insertChallenge",
  "updateChallenge",
  "consumeActiveChallenges",
  "insertSession",
  "updateSession",
  "revokeSession",
  "revokeUserSessions",
  "insertAuditLog",
]);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readSeed(filePath, fs) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw new Error(`无法读取本地认证数据文件：${filePath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`本地认证数据文件格式损坏，请先备份后修复：${filePath}`);
  }
  if (!parsed || parsed.version !== FORMAT_VERSION) {
    throw new Error(`本地认证数据文件版本不受支持：${filePath}`);
  }
  for (const key of ["users", "challenges", "sessions", "auditLogs"]) {
    if (!Array.isArray(parsed[key])) throw new Error(`本地认证数据文件缺少 ${key}：${filePath}`);
  }
  return parsed;
}

function createFileRepository({ filePath, fs = defaultFs, path = defaultPath } = {}) {
  if (!filePath) throw new TypeError("createFileRepository requires filePath");
  const seed = readSeed(filePath, fs) || { users: [], challenges: [], sessions: [], auditLogs: [] };
  const memory = createMemoryRepository(seed);
  if (!memory._debug || !memory._debug.users || !memory._debug.challenges
    || !memory._debug.sessions || !memory._debug.auditLogs) {
    throw new Error("persistent auth repository requires the memory repository debug stores");
  }

  function snapshot() {
    return {
      version: FORMAT_VERSION,
      users: Array.from(memory._debug.users.values()).map(clone),
      challenges: Array.from(memory._debug.challenges.values()).map(clone),
      sessions: Array.from(memory._debug.sessions.values()).map(clone),
      auditLogs: memory._debug.auditLogs.map(clone),
    };
  }

  function persist() {
    const directory = path.dirname(filePath);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      fs.writeFileSync(temporaryPath, `${JSON.stringify(snapshot())}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      try { fs.unlinkSync(temporaryPath); } catch {}
      throw new Error(`无法保存本地认证数据文件：${filePath}（${error.message}）`);
    }
  }

  const repository = {};
  for (const [name, value] of Object.entries(memory)) {
    if (name === "_debug") continue;
    if (typeof value !== "function") {
      repository[name] = value;
      continue;
    }
    repository[name] = async (...args) => {
      const result = await value(...args);
      if (MUTATING_METHODS.has(name)) persist();
      return result;
    };
  }
  repository.close = async () => {
    persist();
    await memory.close?.();
  };
  repository._debug = memory._debug;
  repository.filePath = filePath;
  return repository;
}

module.exports = { FORMAT_VERSION, createFileRepository };
