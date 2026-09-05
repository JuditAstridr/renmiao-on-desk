"use strict";

function normalizeBaseUrl(value) {
  const base = String(value || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  try {
    const parsed = new URL(base);
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function createAuthClient({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error("认证服务地址未配置");
  if (typeof fetchImpl !== "function") throw new Error("fetch 不可用");

  async function request(path, { method = "POST", body, accessToken = "" } = {}) {
    const headers = { "Content-Type": "application/json", Accept: "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetchImpl(`${normalizedBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error?.message || `认证服务请求失败（${response.status}）`);
      error.code = data.error?.code || "auth_request_failed";
      error.status = response.status;
      throw error;
    }
    return data;
  }

  return {
    registerRequest: (payload) => request("/v1/auth/register/request", { body: payload }),
    registerVerify: (payload) => request("/v1/auth/register/verify", { body: payload }),
    loginPassword: (payload) => request("/v1/auth/login/password", { body: payload }),
    loginCodeRequest: (payload) => request("/v1/auth/login/code/request", { body: payload }),
    loginCodeVerify: (payload) => request("/v1/auth/login/code/verify", { body: payload }),
    adminLoginStart: (payload) => request("/v1/admin/auth/start", { body: payload }),
    adminLoginVerify: (payload) => request("/v1/admin/auth/verify", { body: payload }),
    adminListUsers: (accessToken, { query = "", status = "", limit = 50, offset = 0 } = {}) => {
      const params = new URLSearchParams({
        query: String(query || ""),
        status: String(status || ""),
        limit: String(limit),
        offset: String(offset),
      });
      return request(`/v1/admin/users?${params.toString()}`, { method: "GET", accessToken });
    },
    adminListAuditLogs: (accessToken, { limit = 100, offset = 0 } = {}) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      return request(`/v1/admin/audit-logs?${params.toString()}`, { method: "GET", accessToken });
    },
    adminUpdateUser: (accessToken, userId, patch) => request(
      `/v1/admin/users/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: patch, accessToken },
    ),
    adminRevokeUserSessions: (accessToken, userId) => request(
      `/v1/admin/users/${encodeURIComponent(userId)}/sessions/revoke`,
      { method: "POST", body: {}, accessToken },
    ),
    adminResetPasswordRequest: (accessToken, userId) => request(
      `/v1/admin/users/${encodeURIComponent(userId)}/password/reset`,
      { method: "POST", body: {}, accessToken },
    ),
    resetPasswordRequest: (payload) => request("/v1/auth/password/reset/request", { body: payload }),
    resetPassword: (payload) => request("/v1/auth/password/reset", { body: payload }),
    verifyEmailChange: (payload) => request("/v1/auth/email/change/verify", { body: payload }),
    refresh: (refreshToken) => request("/v1/auth/token/refresh", { body: { refreshToken } }),
    logout: (refreshToken) => request("/v1/auth/logout", { body: { refreshToken } }),
    me: (accessToken) => request("/v1/me", { method: "GET", accessToken }),
  };
}

module.exports = { createAuthClient, normalizeBaseUrl };
