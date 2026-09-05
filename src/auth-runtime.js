"use strict";

const { pathToFileURL } = require("node:url");
const defaultPath = require("node:path");

const { createAuthClient } = require("./auth-client");
const { createAuthSessionStore } = require("./auth-session-store");
const { resolveAuthApiUrl } = require("./auth-config");

function isLiveWindow(win) {
  return !!win && (typeof win.isDestroyed !== "function" || !win.isDestroyed());
}

function createAuthRuntime({
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
  baseUrl,
  authHtmlPath = defaultPath.join(__dirname, "auth.html"),
  preloadPath = defaultPath.join(__dirname, "preload-auth.js"),
  adminHtmlPath = defaultPath.join(__dirname, "admin.html"),
  adminPreloadPath = defaultPath.join(__dirname, "preload-admin.js"),
  userDataDir,
  getMainWindows = () => [],
  setMainWindowsVisible = null,
  onAuthenticated = () => {},
} = {}) {
  if (!app || !BrowserWindow || !ipcMain) throw new TypeError("createAuthRuntime requires app, BrowserWindow and ipcMain");
  const resolvedBaseUrl = baseUrl === undefined
    ? resolveAuthApiUrl({
      userDataDir,
      resourcesPath: app.isPackaged ? process.resourcesPath : "",
    })
    : baseUrl;
  const configured = !!String(resolvedBaseUrl || "").trim() && process.env.RENMI_AUTH_DISABLED !== "1";
  const client = configured ? createAuthClient({ baseUrl: resolvedBaseUrl }) : null;
  const sessionStore = configured ? createAuthSessionStore({
    filePath: defaultPath.join(userDataDir || app.getPath("userData"), "renmi-auth-session.json"),
    safeStorage,
  }) : null;
  const pageUrl = pathToFileURL(authHtmlPath).href;
  let authWindow = null;
  let adminWindow = null;
  let session = null;
  let refreshPromise = null;
  let registered = false;

  function hideMainWindows() {
    if (typeof setMainWindowsVisible === "function") return setMainWindowsVisible(false);
    for (const win of getMainWindows() || []) if (isLiveWindow(win)) win.hide();
  }

  function showMainWindows() {
    if (typeof setMainWindowsVisible === "function") return setMainWindowsVisible(true);
    for (const win of getMainWindows() || []) if (isLiveWindow(win)) win.show();
  }

  function saveSession(result) {
    if (!result || !result.refreshToken) throw new Error("认证服务未返回有效会话");
    session = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
      expiresInSeconds: result.expiresInSeconds,
    };
    sessionStore.save(session);
    return session;
  }

  function closeAuthWindow() {
    if (!isLiveWindow(authWindow)) { authWindow = null; return; }
    authWindow.close();
    authWindow = null;
  }

  function closeAdminWindow() {
    if (!isLiveWindow(adminWindow)) { adminWindow = null; return; }
    adminWindow.close();
    adminWindow = null;
  }

  async function logoutCurrentSession() {
    const refreshToken = session && session.refreshToken;
    try {
      if (refreshToken) await client.logout(refreshToken);
    } finally {
      session = null;
      refreshPromise = null;
      sessionStore.clear();
      closeAdminWindow();
      hideMainWindows();
    }
    return { status: "ok" };
  }

  function finishAuthentication(result) {
    saveSession(result);
    showMainWindows();
    closeAuthWindow();
    try { onAuthenticated(session.user); } catch (error) { console.warn("Renmi auth callback failed:", error.message); }
    if (session.user && session.user.role === "admin") openAdminWindow();
    return { status: "ok", user: session.user };
  }

  function ensureTrusted(event, sourceWindow) {
    if (!sourceWindow || !isLiveWindow(sourceWindow)) throw new Error("认证窗口不可用");
    if (!event || event.sender !== sourceWindow.webContents) throw new Error("untrusted auth sender");
  }

  async function adminRequest(request) {
    if (!session || !session.user || session.user.role !== "admin") {
      throw new Error("需要管理员权限");
    }
    try {
      return await request(session.accessToken);
    } catch (error) {
      if (!error || error.status !== 401 || !session.refreshToken) throw error;
      if (!refreshPromise) {
        const refreshToken = session.refreshToken;
        refreshPromise = client.refresh(refreshToken)
          .then((result) => saveSession(result))
          .finally(() => { refreshPromise = null; });
      }
      await refreshPromise;
      if (!session || !session.user || session.user.role !== "admin") throw error;
      return request(session.accessToken);
    }
  }

  function registerIpc() {
    if (registered || !configured) return;
    registered = true;
    const handle = (channel, listener) => {
      ipcMain.handle(channel, async (event, payload) => {
        ensureTrusted(event, authWindow);
        return listener(payload || {});
      });
    };
    const handleAdmin = (channel, listener) => {
      ipcMain.handle(channel, async (event, payload) => {
        ensureTrusted(event, adminWindow);
        return listener(payload || {});
      });
    };
    handle("auth:get-state", () => ({ configured: true, user: session && session.user }));
    handle("auth:register-request", (payload) => client.registerRequest(payload));
    handle("auth:register-verify", async (payload) => finishAuthentication(await client.registerVerify(payload)));
    handle("auth:login-password", async (payload) => finishAuthentication(await client.loginPassword(payload)));
    handle("auth:login-code-request", (payload) => client.loginCodeRequest(payload));
    handle("auth:login-code-verify", async (payload) => finishAuthentication(await client.loginCodeVerify(payload)));
    handle("auth:admin-login-start", (payload) => client.adminLoginStart(payload));
    handle("auth:admin-login-verify", async (payload) => finishAuthentication(await client.adminLoginVerify(payload)));
    handle("auth:reset-password-request", (payload) => client.resetPasswordRequest(payload));
    handle("auth:reset-password", async (payload) => finishAuthentication(await client.resetPassword(payload)));
    handle("auth:verify-email-change", (payload) => client.verifyEmailChange(payload));
    handle("auth:logout", () => logoutCurrentSession());
    handle("auth:close", () => {
      closeAuthWindow();
      return { status: "ok" };
    });
    handleAdmin("admin:list-users", (payload) => adminRequest((accessToken) => client.adminListUsers(accessToken, payload)));
    handleAdmin("admin:list-audit-logs", (payload) => adminRequest((accessToken) => client.adminListAuditLogs(accessToken, payload)));
    handleAdmin("admin:update-user", (payload) => adminRequest((accessToken) => (
      client.adminUpdateUser(accessToken, payload.userId, payload.patch || {})
    )));
    handleAdmin("admin:revoke-user-sessions", (payload) => adminRequest((accessToken) => (
      client.adminRevokeUserSessions(accessToken, payload.userId)
    )));
    handleAdmin("admin:reset-password-request", (payload) => adminRequest((accessToken) => (
      client.adminResetPasswordRequest(accessToken, payload.userId)
    )));
    handleAdmin("admin:logout", async () => {
      await logoutCurrentSession();
      openAuthWindow();
      return { status: "ok" };
    });
    handleAdmin("admin:close", () => {
      closeAdminWindow();
      return { status: "ok" };
    });
  }

  function openAuthWindow() {
    if (isLiveWindow(authWindow)) {
      authWindow.show();
      authWindow.focus();
      return authWindow;
    }
    authWindow = new BrowserWindow({
      width: 420,
      height: 680,
      minWidth: 380,
      minHeight: 600,
      maxWidth: 520,
      maxHeight: 820,
      resizable: true,
      show: false,
      title: "renmiao",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    authWindow.setMenuBarVisibility?.(false);
    authWindow.on("closed", () => {
      authWindow = null;
    });
    authWindow.webContents.on("did-finish-load", () => {
      if (isLiveWindow(authWindow)) authWindow.show();
    });
    authWindow.loadURL(pageUrl);
    return authWindow;
  }

  function openAdminWindow() {
    if (!session || !session.user || session.user.role !== "admin") return null;
    if (isLiveWindow(adminWindow)) {
      adminWindow.show();
      adminWindow.focus();
      return adminWindow;
    }
    adminWindow = new BrowserWindow({
      width: 1120,
      height: 780,
      minWidth: 860,
      minHeight: 620,
      show: false,
      title: "renmiao 管理后台",
      webPreferences: {
        preload: adminPreloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    adminWindow.setMenuBarVisibility?.(false);
    adminWindow.on("closed", () => { adminWindow = null; });
    adminWindow.webContents.on("did-finish-load", () => {
      if (isLiveWindow(adminWindow)) adminWindow.show();
    });
    adminWindow.loadURL(pathToFileURL(adminHtmlPath).href);
    return adminWindow;
  }

  async function restoreSession() {
    const stored = sessionStore.load();
    if (!stored || !stored.refreshToken) return false;
    try {
      const result = await client.refresh(stored.refreshToken);
      saveSession(result);
      showMainWindows();
      try { onAuthenticated(session.user); } catch (error) { console.warn("Renmi auth callback failed:", error.message); }
      if (session.user && session.user.role === "admin") openAdminWindow();
      return true;
    } catch (error) {
      if (error && [401, 403].includes(error.status)) sessionStore.clear();
      return false;
    }
  }

  async function start() {
    if (!configured) return { status: "disabled" };
    registerIpc();
    hideMainWindows();
    if (await restoreSession()) return { status: "authenticated", user: session.user };
    openAuthWindow();
    return { status: "login-required" };
  }

  function getSession() { return session ? { ...session, user: session.user ? { ...session.user } : null } : null; }
  function dispose() {
    closeAuthWindow();
    if (registered) {
      for (const channel of [
        "auth:get-state", "auth:register-request", "auth:register-verify", "auth:login-password",
        "auth:login-code-request", "auth:login-code-verify", "auth:reset-password-request",
        "auth:admin-login-start", "auth:admin-login-verify", "auth:reset-password",
        "auth:verify-email-change", "auth:logout", "auth:close", "admin:list-users",
        "admin:list-audit-logs", "admin:update-user", "admin:revoke-user-sessions",
        "admin:reset-password-request", "admin:logout", "admin:close",
      ]) ipcMain.removeHandler(channel);
      registered = false;
    }
    closeAdminWindow();
  }

  return {
    isConfigured: () => configured,
    start,
    openAuthWindow,
    openAdminWindow,
    getSession,
    logout: () => session ? logoutCurrentSession() : { status: "ok" },
    dispose,
  };
}

module.exports = { createAuthRuntime };
