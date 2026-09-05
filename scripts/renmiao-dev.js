#!/usr/bin/env node

"use strict";

const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { constants: osConstants } = require("node:os");
const { isPlaceholderApiUrl, normalizeApiUrl } = require("../src/auth-config");

const ROOT = path.resolve(__dirname, "..");
const API_START_PORT = 8787;
const API_END_PORT = 8791;

function canListen(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    const finish = (available) => {
      probe.removeAllListeners();
      try { probe.close(() => resolve(available)); } catch { resolve(available); }
    };
    probe.once("error", () => finish(false));
    probe.listen(port, "127.0.0.1", () => finish(true));
  });
}

async function findApiPort() {
  for (let port = API_START_PORT; port <= API_END_PORT; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`本地认证服务的 ${API_START_PORT}–${API_END_PORT} 端口都被占用，请关闭旧服务后重试`);
}

function waitForHealth(url, child, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.removeListener("close", onClose);
      child.removeListener("error", onError);
      if (error) reject(error); else resolve();
    };
    const onClose = (code, signal) => finish(new Error(
      `认证服务提前退出（code ${code ?? "null"}, signal ${signal ?? "none"}），请检查 cloud/.env`,
    ));
    const onError = (error) => finish(new Error(
      `认证服务启动失败（${error && error.message ? error.message : error}），请检查 cloud/.env`,
    ));
    const timer = setTimeout(() => finish(new Error("认证服务启动超时，请检查 cloud/.env 和网络")), timeoutMs);
    child.once("close", onClose);
    child.once("error", onError);
    const probe = async () => {
      if (settled) return;
      try {
        const response = await fetch(url);
        if (response.ok) return finish();
      } catch {}
      if (Date.now() - startedAt >= timeoutMs) return finish(new Error("认证服务健康检查超时"));
      setTimeout(probe, 250);
    };
    void probe();
  });
}

async function waitForRemoteHealth(url, timeoutMs = 15000, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") throw new Error("当前 Node 不支持 fetch，无法检查云端认证服务");
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetchImpl(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`云端认证服务健康检查超时：${url}/health`);
}

function resolveRemoteAuthUrl(env = process.env) {
  if (String(env.RENMI_LOCAL_AUTH || "").trim() === "1") return "";
  const raw = String(env.RENMI_AUTH_API_URL || "").trim();
  if (!raw) return "";
  const normalized = normalizeApiUrl(raw);
  if (!normalized || isPlaceholderApiUrl(normalized)) {
    throw new Error("RENMI_AUTH_API_URL 必须是已部署的真实 http(s) 认证服务地址");
  }
  return normalized;
}

function terminate(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2000).unref?.();
}

async function main() {
  const remoteApiUrl = resolveRemoteAuthUrl();
  const useRemoteAuth = !!remoteApiUrl;
  let api = null;
  let apiUrl = remoteApiUrl;
  // Keep `npm start dev` compatible with the old launcher contract.  npm
  // passes positional arguments after the script name through process.argv;
  // forward them to Electron after the auth API is ready.
  const forwardedArgs = process.argv.slice(2);
  if (useRemoteAuth) {
    await waitForRemoteHealth(apiUrl);
  } else {
    const port = await findApiPort();
    apiUrl = `http://127.0.0.1:${port}`;
    api = spawn(process.execPath, [path.join(ROOT, "cloud", "api", "index.js")], {
      cwd: ROOT,
      env: { ...process.env, AUTH_DEV_MODE: "1", AUTH_HOST: "127.0.0.1", AUTH_PORT: String(port) },
      stdio: "inherit",
    });
    try {
      await waitForHealth(`${apiUrl}/health`, api);
    } catch (error) {
      terminate(api);
      throw error;
    }
  }

  let electron = null;
  const stopAll = () => {
    terminate(electron);
    terminate(api);
  };
  process.once("SIGINT", stopAll);
  process.once("SIGTERM", stopAll);
  try {
    const electronEnv = { ...process.env, RENMI_AUTH_API_URL: apiUrl };
    if (!useRemoteAuth) electronEnv.AUTH_DEV_MODE = "1";
    electron = spawn(process.execPath, [path.join(ROOT, "launch.js"), ...forwardedArgs], {
      cwd: ROOT,
      env: electronEnv,
      stdio: "inherit",
    });
    const result = await new Promise((resolve, reject) => {
      electron.once("error", reject);
      electron.once("close", (code, signal) => resolve({ code, signal }));
    });
    const signalNumber = result.signal
      && osConstants.signals
      && osConstants.signals[result.signal];
    const exitCode = Number.isInteger(result.code)
      ? result.code
      : result.signal
        ? 128 + (Number.isInteger(signalNumber) ? signalNumber : 1)
        : 1;
    if (result.code !== 0 || result.signal) {
      process.stderr.write(
        `renmiao dev：Electron 已退出：code=${result.code ?? "null"} signal=${result.signal ?? "none"}\n`,
      );
    }
    process.exitCode = exitCode;
  } finally {
    process.removeListener("SIGINT", stopAll);
    process.removeListener("SIGTERM", stopAll);
    terminate(electron);
    terminate(api);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`renmiao 启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  canListen,
  findApiPort,
  resolveRemoteAuthUrl,
  waitForHealth,
  waitForRemoteHealth,
};
