"use strict";

function createSupabaseRepository({ url, serviceRoleKey, fetchImpl = globalThis.fetch }) {
  if (!url || !serviceRoleKey || typeof fetchImpl !== "function") {
    throw new Error("Supabase repository requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and fetch");
  }

  const apiRoot = new URL("/rest/v1/", url.endsWith("/") ? url : `${url}/`);

  async function request(table, { method = "GET", params = {}, body = undefined, prefer = "", returnResponse = false } = {}) {
    const target = new URL(table, apiRoot);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") target.searchParams.set(key, value);
    }
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };
    if (prefer) headers.Prefer = prefer;
    const response = await fetchImpl(target, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    if (!response.ok) {
      const message = parsed && (parsed.message || parsed.details || parsed.hint)
        ? `${parsed.message || "Supabase request failed"}${parsed.details ? `: ${parsed.details}` : ""}`
        : `Supabase request failed (${response.status})`;
      throw new Error(message);
    }
    return returnResponse ? { data: parsed, response } : parsed;
  }

  async function first(table, params) {
    const rows = await request(table, { params: { ...params, limit: "1" } });
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  async function updateById(table, id, patch) {
    const rows = await request(table, {
      method: "PATCH",
      params: { id: `eq.${id}`, select: "*" },
      body: patch,
      prefer: "return=representation",
    });
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  }

  return {
    findUserByEmailHash(emailHash) {
      return first("users", { email_hash: `eq.${emailHash}`, select: "*" });
    },

    findUserByUsername(usernameNormalized) {
      return first("users", { username_normalized: `eq.${usernameNormalized}`, select: "*" });
    },

    getUserById(id) {
      return first("users", { id: `eq.${id}`, select: "*" });
    },

    async insertUser(data) {
      const rows = await request("users", {
        method: "POST",
        body: data,
        prefer: "return=representation",
      });
      return rows && rows[0] ? rows[0] : null;
    },

    updateUser(id, patch) {
      return updateById("users", id, patch);
    },

    async updateUserProfile(id, profile, expectedUpdatedAt) {
      const params = {
        id: `eq.${id}`,
        select: "*",
      };
      if (expectedUpdatedAt) params.profile_updated_at = `eq.${expectedUpdatedAt}`;
      const rows = await request("users", {
        method: "PATCH",
        params,
        body: { profile_state: profile, profile_updated_at: new Date().toISOString() },
        prefer: "return=representation",
      });
      return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    },

    async insertChallenge(data) {
      const rows = await request("auth_challenges", {
        method: "POST",
        body: data,
        prefer: "return=representation",
      });
      return rows && rows[0] ? rows[0] : null;
    },

    getChallenge(id) {
      return first("auth_challenges", { id: `eq.${id}`, select: "*" });
    },

    updateChallenge(id, patch) {
      return updateById("auth_challenges", id, patch);
    },

    async consumeActiveChallenges(emailHash, purpose, consumedAt = new Date().toISOString()) {
      await request("auth_challenges", {
        method: "PATCH",
        params: { email_hash: `eq.${emailHash}`, purpose: `eq.${purpose}`, consumed_at: "is.null" },
        body: { consumed_at: consumedAt },
        prefer: "return=minimal",
      });
    },

    findActiveChallengeByEmailHash(emailHash, purpose) {
      return first("auth_challenges", {
        email_hash: `eq.${emailHash}`,
        purpose: `eq.${purpose}`,
        consumed_at: "is.null",
        order: "created_at.desc",
        select: "*",
      });
    },

    async insertSession(data) {
      const rows = await request("sessions", {
        method: "POST",
        body: data,
        prefer: "return=representation",
      });
      return rows && rows[0] ? rows[0] : null;
    },

    getSessionByRefreshHash(refreshTokenHash) {
      return first("sessions", { refresh_token_hash: `eq.${refreshTokenHash}`, select: "*" });
    },

    getSessionById(id) {
      return first("sessions", { id: `eq.${id}`, select: "*" });
    },

    updateSession(id, patch) {
      return updateById("sessions", id, patch);
    },

    async revokeSession(id, revokedAt = new Date().toISOString()) {
      return updateById("sessions", id, { revoked_at: revokedAt });
    },

    async revokeUserSessions(userId, revokedAt = new Date().toISOString()) {
      const rows = await request("sessions", {
        method: "PATCH",
        params: { user_id: `eq.${userId}`, revoked_at: "is.null" },
        body: { revoked_at: revokedAt },
        prefer: "return=representation",
      });
      return Array.isArray(rows) ? rows.length : 0;
    },

    async insertAuditLog(data) {
      const rows = await request("audit_logs", {
        method: "POST",
        body: data,
        prefer: "return=representation",
      });
      return rows && rows[0] ? rows[0] : null;
    },

    async listAuditLogs({ limit = 100, offset = 0 } = {}) {
      const rows = await request("audit_logs", {
        params: { select: "*", order: "created_at.desc", limit: String(limit), offset: String(offset) },
      });
      return { rows: Array.isArray(rows) ? rows : [], total: Array.isArray(rows) ? rows.length : 0 };
    },

    async listUsers({ query = "", queryEmailHash = "", status = "", limit = 50, offset = 0 } = {}) {
      const params = {
        select: "*",
        order: "created_at.desc",
        limit: String(limit),
        offset: String(offset),
      };
      if (status) params.status = `eq.${status}`;
      if (queryEmailHash) params.email_hash = `eq.${queryEmailHash}`;
      else if (query) params.username_normalized = `ilike.*${String(query).replace(/[*,()]/g, "") }*`;
      const result = await request("users", { params, prefer: "count=exact", returnResponse: true });
      const rows = Array.isArray(result.data) ? result.data : [];
      const contentRange = result.response.headers.get("content-range") || "";
      const totalMatch = contentRange.match(/\/(\d+)$/);
      const total = totalMatch ? Number(totalMatch[1]) : offset + rows.length;
      return { rows, total: Number.isFinite(total) ? total : rows.length };
    },

    async close() {},
  };
}

module.exports = { createSupabaseRepository };
