"use strict";

const { EventEmitter } = require("node:events");
const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuthRuntime } = require("../src/auth-runtime");

class FakeBrowserWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.webContents = new EventEmitter();
    this.closed = false;
    this.shown = false;
    FakeBrowserWindow.instances.push(this);
  }

  isDestroyed() { return this.closed; }
  setMenuBarVisibility() {}
  loadURL() { this.webContents.emit("did-finish-load"); }
  show() { this.shown = true; }
  focus() {}
  hide() {}
  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit("closed");
  }
}

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, listener) { handlers.set(channel, listener); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

test("admin authentication does not open the admin dashboard automatically", async () => {
  const originalFetch = globalThis.fetch;
  FakeBrowserWindow.instances = [];
  const ipcMain = createIpcMain();
  const app = {
    isPackaged: false,
    getPath() { return "/tmp/renmiao-auth-runtime-test"; },
  };
  const safeStorage = { isEncryptionAvailable() { return false; } };
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/v1\/admin\/auth\/verify$/);
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          accessToken: "admin-access-token",
          refreshToken: "admin-refresh-token",
          expiresInSeconds: 900,
          user: { id: "admin-1", role: "admin", username: "Judit Ástríðr" },
        };
      },
    };
  };

  try {
    const runtime = createAuthRuntime({
      app,
      BrowserWindow: FakeBrowserWindow,
      ipcMain,
      safeStorage,
      baseUrl: "https://auth.example.test",
    });
    await runtime.start();
    const authWindow = FakeBrowserWindow.instances[0];
    assert.equal(authWindow.options.title, "renmiao");

    await ipcMain.handlers.get("auth:admin-login-verify")(
      { sender: authWindow.webContents },
      { challengeId: "challenge-1", code: "ABC123" },
    );

    assert.equal(FakeBrowserWindow.instances.length, 1);
    assert.equal(runtime.getSession().user.role, "admin");
    runtime.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});
