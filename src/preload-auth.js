"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("authAPI", {
  getState: () => ipcRenderer.invoke("auth:get-state"),
  registerRequest: (payload) => ipcRenderer.invoke("auth:register-request", payload),
  registerVerify: (payload) => ipcRenderer.invoke("auth:register-verify", payload),
  loginPassword: (payload) => ipcRenderer.invoke("auth:login-password", payload),
  loginCodeRequest: (payload) => ipcRenderer.invoke("auth:login-code-request", payload),
  loginCodeVerify: (payload) => ipcRenderer.invoke("auth:login-code-verify", payload),
  adminLoginStart: (payload) => ipcRenderer.invoke("auth:admin-login-start", payload),
  adminLoginVerify: (payload) => ipcRenderer.invoke("auth:admin-login-verify", payload),
  resetPasswordRequest: (payload) => ipcRenderer.invoke("auth:reset-password-request", payload),
  resetPassword: (payload) => ipcRenderer.invoke("auth:reset-password", payload),
  verifyEmailChange: (payload) => ipcRenderer.invoke("auth:verify-email-change", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  close: () => ipcRenderer.invoke("auth:close"),
});
