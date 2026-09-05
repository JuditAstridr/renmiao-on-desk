#!/usr/bin/env node

// Cross-platform launcher that ensures Electron runs in GUI mode.
//
// Claude Code (and other Electron-based tools) set ELECTRON_RUN_AS_NODE=1,
// which forces Electron to behave as a plain Node.js process — the browser
// layer never initializes, so `require("electron").app` is undefined.
//
// This launcher strips that variable before spawning the real Electron binary.

const { spawn } = require("child_process");
const { constants: osConstants } = require("node:os");
const {
  verifyElectronInstall,
  formatElectronInstallFailure,
} = require("./scripts/verify-electron-install");

const electronInstall = verifyElectronInstall({ context: "launch" });
if (!electronInstall.ok) {
  process.stderr.write(`${formatElectronInstallFailure(electronInstall)}\n`);
  process.exit(1);
}

const electron = require("electron");
const { buildElectronLaunchConfig } = require("./hooks/shared-process");

const forwardedArgs = process.argv.slice(2);
const launchConfig = buildElectronLaunchConfig(__dirname, { forwardedArgs });
const renmiProfileFlag = process.env.RENMI_ON_DESK_PROFILE || "1";
const child = spawn(electron, launchConfig.args, {
  stdio: "inherit",
  // Keep this checkout's Electron profile explicit so `npm start` and direct
  // launcher invocations both use Renmi's isolated userData/runtime paths.
  env: { ...launchConfig.env, RENMI_ON_DESK_PROFILE: renmiProfileFlag },
  cwd: launchConfig.cwd,
});

child.once("error", (error) => {
  process.stderr.write(`renmiao Electron 启动失败：${error && error.message ? error.message : error}\n`);
});

child.once("close", (code, signal) => {
  // Preserve signal exits instead of turning a native crash (for example
  // SIGABRT) into a misleading successful exit. The dev wrapper uses this
  // distinction to tell an intentional close from an Electron failure.
  const signalNumber = signal && osConstants.signals && osConstants.signals[signal];
  const exitCode = Number.isInteger(code)
    ? code
    : signal
      ? 128 + (Number.isInteger(signalNumber) ? signalNumber : 1)
      : 1;
  if (code !== 0 || signal) {
    process.stderr.write(
      `renmiao Electron 已退出：code=${code ?? "null"} signal=${signal ?? "none"}\n`,
    );
  }
  process.exitCode = exitCode;
});
