"use strict";

const { loadEnv } = require("./load-env");
loadEnv();

const { createConfig } = require("./config");
const { createEmailer } = require("./emailer");
const { createFileRepository } = require("./file-repository");
const { createSupabaseRepository } = require("./supabase-repository");
const { createAuthService } = require("./auth-service");
const { createAuthHttpServer } = require("./server");

function createRepository(config) {
  if (config.devMode) return createFileRepository({ filePath: config.devDataPath });
  if (config.supabaseUrl && config.supabaseServiceRoleKey) {
    return createSupabaseRepository({
      url: config.supabaseUrl,
      serviceRoleKey: config.supabaseServiceRoleKey,
    });
  }
  throw new Error("Cloud mode requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}

async function main() {
  const config = createConfig();
  if (!config.adminPasswordHash) throw new Error("RENMI_ADMIN_PASSWORD_HASH is required; run cloud:hash-password and put the result in cloud/.env");
  if (!config.adminPasswordHash.startsWith("scrypt$")) {
    throw new Error("RENMI_ADMIN_PASSWORD_HASH is not a valid hash; copy the complete output of npm run cloud:hash-password into cloud/.env");
  }
  if (!config.resendApiKey) throw new Error("RESEND_API_KEY is required; verification codes are sent by email and are never printed to the terminal");
  if (!config.emailFrom || config.emailFrom.includes("example.com")) {
    throw new Error("AUTH_EMAIL_FROM must be a sender address on a verified Resend domain");
  }
  const repo = createRepository(config);
  const emailer = createEmailer(config);
  const service = createAuthService({ repo, emailer, config });
  await service.ensureAdmin();
  const server = createAuthHttpServer({ service, config });
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.port, config.host);
  }).catch((error) => {
    if (error && error.code === "EADDRINUSE") {
      throw new Error(`认证服务端口 ${config.host}:${config.port} 已被占用；请关闭旧服务，或直接运行 npm run dev 自动选择空闲端口`);
    }
    throw error;
  });
  console.log(`Renmi auth API listening on http://${config.host}:${config.port}`);
  const shutdown = async () => {
    await new Promise((resolve) => server.close(() => resolve()));
    await repo.close?.();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return { server, service, repo, config };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Renmi auth startup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createRepository, main };
