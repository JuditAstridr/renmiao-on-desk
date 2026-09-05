"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("adminAPI", {
  listUsers: (payload) => ipcRenderer.invoke("admin:list-users", payload),
  listAuditLogs: (payload) => ipcRenderer.invoke("admin:list-audit-logs", payload),
  updateUser: (payload) => ipcRenderer.invoke("admin:update-user", payload),
  revokeUserSessions: (payload) => ipcRenderer.invoke("admin:revoke-user-sessions", payload),
  resetPassword: (payload) => ipcRenderer.invoke("admin:reset-password", payload),
  logout: () => ipcRenderer.invoke("admin:logout"),
  close: () => ipcRenderer.invoke("admin:close"),
});
