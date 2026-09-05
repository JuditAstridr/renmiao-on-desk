"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuthClient } = require("../src/auth-client");

test("admin client sends bearer-authenticated paginated management requests", async () => {
  const calls = [];
  const client = createAuthClient({
    baseUrl: "https://auth.example.test/",
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 200,
        async json() { return { rows: [], total: 0 }; },
      };
    },
  });

  await client.adminListUsers("admin-access-token", {
    query: "Judit & users",
    status: "active",
    limit: 50,
    offset: 100,
  });
  assert.match(calls[0].url, /\/v1\/admin\/users\?query=Judit\+%26\+users&status=active&limit=50&offset=100$/);
  assert.equal(calls[0].options.headers.Authorization, "Bearer admin-access-token");
  assert.equal(calls[0].options.method, "GET");

  await client.adminUpdateUser("admin-access-token", "user/1", { status: "suspended" });
  assert.match(calls[1].url, /\/v1\/admin\/users\/user%2F1$/);
  assert.equal(calls[1].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body), { status: "suspended" });
});
