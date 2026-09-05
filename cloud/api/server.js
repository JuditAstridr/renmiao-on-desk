"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { AuthError, assertEmail } = require("./auth-core");

// Profile updates contain a bounded task list. Keep the HTTP ceiling above the
// profile budget while remaining finite for all other endpoints.
const MAX_BODY_BYTES = 768 * 1024;

function json(res, status, body, headers = {}) {
  const encoded = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(encoded);
}

function requestId(req) {
  const supplied = String(req.headers["x-request-id"] || "").trim();
  return supplied && supplied.length <= 100 ? supplied : crypto.randomUUID();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AuthError("请求内容过大", 413, "body_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new AuthError("请求格式无效", 400, "invalid_json")); }
    });
    req.on("error", reject);
  });
}

function bearerToken(req) {
  const value = String(req.headers.authorization || "");
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

function clientRequest(req, config) {
  const forwardedFor = config && config.trustProxy ? req.headers["x-forwarded-for"] : "";
  return {
    ip: String(forwardedFor || req.socket.remoteAddress || "").split(",")[0].trim(),
    userAgent: String(req.headers["user-agent"] || "").slice(0, 300),
    deviceName: String(req.headers["x-renmi-device"] || "Renmi Desktop").slice(0, 120),
    requestId: requestId(req),
  };
}

function createRateLimiter({ windowMs = 60_000, max = 20, now = Date.now } = {}) {
  const entries = new Map();
  return {
    check(key) {
      const current = now();
      const record = entries.get(key);
      if (!record || current - record.startedAt >= windowMs) {
        entries.set(key, { startedAt: current, count: 1 });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      record.count += 1;
      if (record.count <= max) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.ceil((windowMs - (current - record.startedAt)) / 1000) };
    },
  };
}

function createAuthHttpServer({ service, config, adminHtmlDir = path.join(__dirname, "..", "admin") } = {}) {
  if (!service || !config) throw new TypeError("createAuthHttpServer requires service and config");
  const ipLimiter = createRateLimiter({ windowMs: 60_000, max: config.devMode ? 1000 : 30 });
  const codeLimiter = createRateLimiter({ windowMs: 60 * 60_000, max: config.devMode ? 1000 : 10 });

  function corsHeaders(req) {
    const origin = String(req.headers.origin || "");
    const allowed = config.allowedOrigins.includes("*") || config.allowedOrigins.includes(origin);
    return {
      ...(allowed && origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id, X-Renmi-Device",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    };
  }

  function checkIpLimit(req, { code = false } = {}) {
    const forwardedFor = config.trustProxy ? req.headers["x-forwarded-for"] : "";
    const address = String(forwardedFor || req.socket.remoteAddress || "unknown").split(",")[0].trim();
    const key = `${code ? "code" : "request"}:${address}`;
    const result = (code ? codeLimiter : ipLimiter).check(key);
    if (!result.allowed) throw new AuthError(`请求过于频繁，请 ${result.retryAfterSeconds} 秒后重试`, 429, "rate_limited");
  }

  async function requireUser(req, { admin = false } = {}) {
    const user = await service.authenticateAccessToken(bearerToken(req));
    if (admin && user.role !== "admin") throw new AuthError("需要管理员权限", 403, "admin_required");
    return user;
  }

  async function handleApi(req, res, pathname) {
    const body = ["POST", "PATCH"].includes(req.method) ? await readBody(req) : {};
    const request = clientRequest(req, config);

    if (req.method === "POST" && pathname === "/v1/auth/register/request") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.registerRequest(body), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/register/verify") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.registerVerify({ ...body, request }), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/login/password") {
      checkIpLimit(req);
      return json(res, 200, await service.loginPassword({ ...body, request }), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/login/code/request") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.loginCodeRequest(body), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/login/code/verify") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.loginCodeVerify({ ...body, request }), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/password/reset/request") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.resetPasswordRequest(body), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/password/reset") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.resetPassword(body), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/email/change/verify") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.verifyEmailChange(body), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/token/refresh") {
      checkIpLimit(req);
      return json(res, 200, await service.refreshSession(body.refreshToken, request), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/auth/logout") {
      checkIpLimit(req);
      return json(res, 200, await service.logout(body.refreshToken), corsHeaders(req));
    }
      if (req.method === "GET" && pathname === "/v1/me") {
      const user = await requireUser(req);
      return json(res, 200, { user: service.publicUser(user) }, corsHeaders(req));
    }
    if (req.method === "GET" && pathname === "/v1/me/profile") {
      const user = await requireUser(req);
      return json(res, 200, await service.getUserProfile(user.id), corsHeaders(req));
    }
    if (req.method === "PATCH" && pathname === "/v1/me/profile") {
      const user = await requireUser(req);
      return json(res, 200, await service.updateUserProfile({
        user,
        profile: body.profile,
        expectedUpdatedAt: body.expectedUpdatedAt,
        request,
      }), corsHeaders(req));
    }

    if (req.method === "POST" && pathname === "/v1/admin/auth/start") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.adminLoginStart(body), corsHeaders(req));
    }
    if (req.method === "POST" && pathname === "/v1/admin/auth/verify") {
      checkIpLimit(req, { code: true });
      return json(res, 200, await service.adminLoginVerify({ ...body, request }), corsHeaders(req));
    }
    if (pathname === "/v1/admin/users" && req.method === "GET") {
      const admin = await requireUser(req, { admin: true });
      const query = new URL(req.url, "http://localhost").searchParams;
      const result = await service.listUsers({
        query: query.get("query") || "",
        status: query.get("status") || "",
        limit: query.get("limit") || 50,
        offset: query.get("offset") || 0,
      });
      await service.recordAdminAction?.({ admin, action: "list_users", request });
      return json(res, 200, result, corsHeaders(req));
    }
    if (pathname === "/v1/admin/audit-logs" && req.method === "GET") {
      await requireUser(req, { admin: true });
      const query = new URL(req.url, "http://localhost").searchParams;
      return json(res, 200, await service.listAuditLogs({
        limit: query.get("limit") || 100,
        offset: query.get("offset") || 0,
      }), corsHeaders(req));
    }
    const profileMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/profile$/);
    if (profileMatch && req.method === "GET") {
      await requireUser(req, { admin: true });
      return json(res, 200, await service.adminGetUserProfile({
        userId: decodeURIComponent(profileMatch[1]),
      }), corsHeaders(req));
    }
    if (profileMatch && req.method === "PATCH") {
      const admin = await requireUser(req, { admin: true });
      return json(res, 200, await service.adminUpdateUserProfile({
        admin,
        userId: decodeURIComponent(profileMatch[1]),
        profile: body.profile,
        expectedUpdatedAt: body.expectedUpdatedAt,
        request,
      }), corsHeaders(req));
    }
    const userMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)$/);
    if (userMatch && req.method === "PATCH") {
      const admin = await requireUser(req, { admin: true });
      const userId = decodeURIComponent(userMatch[1]);
      return json(res, 200, await service.updateUser({ admin, userId, patch: body, request }), corsHeaders(req));
    }
    const sessionMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/sessions\/revoke$/);
    if (sessionMatch && req.method === "POST") {
      const admin = await requireUser(req, { admin: true });
      return json(res, 200, await service.revokeUserSessions({
        admin,
        userId: decodeURIComponent(sessionMatch[1]),
        request,
      }), corsHeaders(req));
    }
    const resetMatch = pathname.match(/^\/v1\/admin\/users\/([^/]+)\/password\/reset$/);
    if (resetMatch && req.method === "POST") {
      const admin = await requireUser(req, { admin: true });
      return json(res, 200, await service.adminResetPassword({
        admin,
        userId: decodeURIComponent(resetMatch[1]),
        password: body.password,
        request,
      }), corsHeaders(req));
    }
    throw new AuthError("接口不存在", 404, "not_found");
  }

  function serveAdmin(req, res, pathname) {
    const relative = pathname === "/admin" || pathname === "/admin/" ? "index.html" : pathname.slice("/admin/".length);
    if (!relative || relative.includes("..") || relative.includes("\\")) return false;
    const filePath = path.join(adminHtmlDir, relative);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
    res.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const headers = corsHeaders(req);
    if (req.method === "OPTIONS") return json(res, 204, {}, headers);
    const pathname = new URL(req.url, "http://localhost").pathname;
    try {
      if (pathname === "/health" && req.method === "GET") return json(res, 200, { ok: true, service: "renmi-auth" }, headers);
      if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        if (serveAdmin(req, res, pathname)) return;
      }
      if (!pathname.startsWith("/v1/")) throw new AuthError("接口不存在", 404, "not_found");
      await handleApi(req, res, pathname);
    } catch (error) {
      const requestIdValue = String(req.headers["x-request-id"] || "");
      if (error instanceof AuthError) {
        return json(res, error.status, {
          error: {
            code: error.code,
            message: error.message,
            requestId: requestIdValue || null,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        }, headers);
      }
      console.error("Renmi auth request failed:", error);
      return json(res, 500, { error: { code: "internal_error", message: "服务器暂时不可用" } }, headers);
    }
  });
  return server;
}

module.exports = { createAuthHttpServer, createRateLimiter };
