"use strict";

const crypto = require("node:crypto");

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function emailUniqueViolation(emailHash) {
  const error = new Error(`email_hash must be unique: ${emailHash}`);
  error.code = "email_unique_violation";
  return error;
}

function createMemoryRepository(seed = {}) {
  const users = new Map((seed.users || []).map((row) => [row.id, clone(row)]));
  const challenges = new Map((seed.challenges || []).map((row) => [row.id, clone(row)]));
  const sessions = new Map((seed.sessions || []).map((row) => [row.id, clone(row)]));
  const auditLogs = (seed.auditLogs || []).map(clone);

  function listValues(map) {
    return Array.from(map.values()).map(clone);
  }

  function assertEmailHashAvailable(emailHash, currentId = null) {
    if (!emailHash) return;
    for (const row of users.values()) {
      if (row.id !== currentId && row.email_hash === emailHash) {
        throw emailUniqueViolation(emailHash);
      }
    }
  }

  return {
    async findUserByEmailHash(emailHash) {
      return listValues(users).find((row) => row.email_hash === emailHash) || null;
    },

    async findUserByUsername(usernameNormalized) {
      return listValues(users).find((row) => row.username_normalized === usernameNormalized) || null;
    },

    async getUserById(id) {
      return clone(users.get(id) || null);
    },

    async insertUser(data) {
      assertEmailHashAvailable(data.email_hash);
      const row = {
        id: data.id || crypto.randomUUID(),
        created_at: data.created_at || nowIso(),
        updated_at: data.updated_at || nowIso(),
        ...clone(data),
      };
      users.set(row.id, row);
      return clone(row);
    },

    async updateUser(id, patch) {
      const current = users.get(id);
      if (!current) return null;
      if (Object.prototype.hasOwnProperty.call(patch || {}, "email_hash")) {
        assertEmailHashAvailable(patch.email_hash, id);
      }
      const next = { ...current, ...clone(patch), updated_at: nowIso() };
      users.set(id, next);
      return clone(next);
    },

    async updateUserProfile(id, profile, expectedUpdatedAt) {
      const current = users.get(id);
      if (!current) return null;
      const currentUpdatedAt = current.profile_updated_at || current.updated_at || null;
      if (expectedUpdatedAt && currentUpdatedAt !== expectedUpdatedAt) return null;
      const next = {
        ...current,
        profile_state: clone(profile),
        profile_updated_at: nowIso(),
        updated_at: nowIso(),
      };
      users.set(id, next);
      return clone(next);
    },

    async insertChallenge(data) {
      const row = {
        id: data.id || crypto.randomUUID(),
        created_at: data.created_at || nowIso(),
        attempt_count: 0,
        ...clone(data),
      };
      challenges.set(row.id, row);
      return clone(row);
    },

    async getChallenge(id) {
      return clone(challenges.get(id) || null);
    },

    async updateChallenge(id, patch) {
      const current = challenges.get(id);
      if (!current) return null;
      const next = { ...current, ...clone(patch) };
      challenges.set(id, next);
      return clone(next);
    },

    async consumeActiveChallenges(emailHash, purpose, consumedAt = nowIso()) {
      for (const [id, row] of challenges.entries()) {
        if (row.email_hash !== emailHash || row.purpose !== purpose || row.consumed_at) continue;
        challenges.set(id, { ...row, consumed_at: consumedAt });
      }
    },

    async findActiveChallengeByEmailHash(emailHash, purpose) {
      return listValues(challenges)
        .filter((row) => row.email_hash === emailHash && row.purpose === purpose && !row.consumed_at)
        .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0] || null;
    },

    async insertSession(data) {
      const row = {
        id: data.id || crypto.randomUUID(),
        created_at: data.created_at || nowIso(),
        last_seen_at: data.last_seen_at || nowIso(),
        ...clone(data),
      };
      sessions.set(row.id, row);
      return clone(row);
    },

    async getSessionByRefreshHash(refreshTokenHash) {
      return listValues(sessions).find((row) => row.refresh_token_hash === refreshTokenHash) || null;
    },

    async getSessionById(id) {
      return clone(sessions.get(id) || null);
    },

    async updateSession(id, patch) {
      const current = sessions.get(id);
      if (!current) return null;
      const next = { ...current, ...clone(patch) };
      sessions.set(id, next);
      return clone(next);
    },

    async revokeSession(id, revokedAt = nowIso()) {
      return this.updateSession(id, { revoked_at: revokedAt });
    },

    async revokeUserSessions(userId, revokedAt = nowIso()) {
      let count = 0;
      for (const [id, row] of sessions.entries()) {
        if (row.user_id !== userId || row.revoked_at) continue;
        sessions.set(id, { ...row, revoked_at: revokedAt });
        count += 1;
      }
      return count;
    },

    async insertAuditLog(data) {
      const row = {
        id: data.id || crypto.randomUUID(),
        created_at: data.created_at || nowIso(),
        ...clone(data),
      };
      auditLogs.push(row);
      return clone(row);
    },

    async listAuditLogs({ limit = 100, offset = 0 } = {}) {
      const rows = auditLogs.slice().reverse();
      return { rows: rows.slice(offset, offset + limit).map(clone), total: rows.length };
    },

    async listUsers({ query = "", queryEmailHash = "", status = "", limit = 50, offset = 0 } = {}) {
      const normalizedQuery = String(query || "").trim().toLocaleLowerCase("und");
      const rows = listValues(users).filter((row) => {
        if (status && row.status !== status) return false;
        if (!normalizedQuery && !queryEmailHash) return true;
        return (normalizedQuery && String(row.username_normalized || "").includes(normalizedQuery))
          || (queryEmailHash && row.email_hash === queryEmailHash);
      }).sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)));
      return {
        rows: rows.slice(offset, offset + limit),
        total: rows.length,
      };
    },

    async close() {},

    _debug: { users, challenges, sessions, auditLogs },
  };
}

module.exports = { createMemoryRepository };
