"use strict";

const state = { challengeId: "", accessToken: "", refreshToken: "", passwordUserId: "", passwordUserName: "", passwordSubmitting: false };
const $ = (id) => document.getElementById(id);

function message(target, value = "") { $(target).textContent = value; }

async function api(path, options = {}, retry = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.accessToken) headers.Authorization = `Bearer ${state.accessToken}`;
  const response = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && retry && state.refreshToken && !path.includes("/v1/auth/token/refresh")) {
    const refreshed = await api("/v1/auth/token/refresh", {
      method: "POST",
      body: { refreshToken: state.refreshToken },
    }, false);
    state.accessToken = refreshed.accessToken;
    state.refreshToken = refreshed.refreshToken;
    return api(path, options, false);
  }
  if (!response.ok) throw new Error(data.error?.message || "请求失败");
  return data;
}

async function sendCode() {
  message("login-message", "正在验证管理员密码并发送验证码…");
  const data = await api("/v1/admin/auth/start", {
    method: "POST",
    body: { email: $("admin-email").value, password: $("admin-password").value },
  });
  state.challengeId = data.challengeId;
  message("login-message", `验证码已发送至 ${data.email || "管理员邮箱"}，有效期约 10 分钟。`);
}

async function login(event) {
  event.preventDefault();
  if (!state.challengeId) { message("login-message", "请先发送验证码"); return; }
  const data = await api("/v1/admin/auth/verify", {
    method: "POST",
    body: { challengeId: state.challengeId, code: $("admin-code").value },
  });
  state.accessToken = data.accessToken;
  state.refreshToken = data.refreshToken;
  $("login-view").hidden = true;
  $("dashboard-view").hidden = false;
  await Promise.all([loadUsers(), loadAuditLogs()]);
}

function safe(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]);
}

function statusLabel(status) {
  return ({ active: "正常", pending: "待验证", suspended: "已封禁", deleted: "已注销" })[status] || status;
}

async function loadUsers() {
  const query = new URLSearchParams({ query: $("user-query").value, status: $("user-status").value });
  const data = await api(`/v1/admin/users?${query}`);
  $("users-body").innerHTML = data.rows.map((user) => `<tr>
    <td>${safe(user.username)}</td><td>${safe(user.email)}</td>
    <td><span class="status ${safe(user.status)}">${safe(statusLabel(user.status))}</span></td>
    <td>${safe(new Date(user.createdAt).toLocaleString())}</td>
    <td class="row-actions">
      ${user.status === "suspended" ? `<button data-action="activate" data-id="${safe(user.id)}">解封</button>` : `<button data-action="suspend" data-id="${safe(user.id)}">封禁</button>`}
      ${user.status !== "deleted" ? `<button data-action="delete" data-id="${safe(user.id)}">注销</button>` : ""}
      ${user.status === "active" ? `<button data-action="reset" data-id="${safe(user.id)}" data-username="${safe(user.username)}">重置密码</button>` : ""}
      ${user.status !== "deleted" ? `<button data-action="edit" data-id="${safe(user.id)}" data-username="${safe(user.username)}" data-email="${safe(user.email)}">编辑</button>` : ""}
      <button data-action="revoke" data-id="${safe(user.id)}">撤销会话</button>
    </td></tr>`).join("") || `<tr><td colspan="5">暂无用户</td></tr>`;
}

const ACTION_LABELS = {
  force_password_reset: "强制要求用户重置密码",
  admin_reset_password: "管理员重置密码",
  suspend_user: "封禁用户",
  delete_user: "注销用户",
  update_user: "更新用户",
  revoke_user_sessions: "撤销会话",
};

async function loadAuditLogs() {
  const data = await api("/v1/admin/audit-logs?limit=100");
  $("audit-body").innerHTML = data.rows.map((log) => `<tr>
    <td>${safe(new Date(log.created_at).toLocaleString())}</td>
    <td>${safe(ACTION_LABELS[log.action] || log.action)}</td>
    <td>${safe(log.target_user_id || "—")}</td>
    <td>${safe(log.ip || "—")}</td>
    <td>${safe(JSON.stringify(log.metadata || {}))}</td>
  </tr>`).join("") || `<tr><td colspan="5">暂无日志</td></tr>`;
}

async function userAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const userId = button.dataset.id;
  if ((action === "delete" || action === "suspend") && !window.confirm(action === "delete" ? "确认注销这个账户？" : "确认封禁这个账户？")) return;
  if (action === "reset") {
    openPasswordDialog(userId, button.dataset.username || "该用户");
    return;
  }
  if (action === "revoke") {
    await api(`/v1/admin/users/${encodeURIComponent(userId)}/sessions/revoke`, { method: "POST", body: {} });
  } else if (action === "edit") {
    const username = window.prompt("用户名", button.dataset.username || "");
    if (username === null) return;
    const email = window.prompt("绑定邮箱（必须是 @ruc.edu.cn）", button.dataset.email || "");
    if (email === null) return;
    const result = await api(`/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { username, email } });
    if (result.emailVerification) message("dashboard-message", `新邮箱验证码已发送至 ${result.emailVerification.email}，用户验证后才会恢复登录。`);
  } else {
    await api(`/v1/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body: { status: action === "activate" ? "active" : action === "suspend" ? "suspended" : "deleted" } });
  }
  await Promise.all([loadUsers(), loadAuditLogs()]);
}

function openPasswordDialog(userId, username) {
  state.passwordUserId = userId;
  state.passwordUserName = username;
  state.passwordSubmitting = false;
  $("password-dialog-user").textContent = "正在为“" + username + "”设置新密码。";
  $("admin-new-password").value = "";
  $("admin-new-password-confirm").value = "";
  $("password-dialog-message").textContent = "至少 10 个字符。";
  $("password-dialog-message").classList.remove("success");
  $("password-dialog").hidden = false;
  $("admin-new-password").focus();
}

function closePasswordDialog() {
  if (state.passwordSubmitting) return;
  $("password-dialog").hidden = true;
  state.passwordUserId = "";
  state.passwordUserName = "";
}

$("password-dialog-cancel").addEventListener("click", closePasswordDialog);
$("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.passwordSubmitting) return;
  const password = $("admin-new-password").value;
  const confirmation = $("admin-new-password-confirm").value;
  if (password !== confirmation) {
    $("password-dialog-message").textContent = "两次输入的密码不一致。";
    return;
  }
  state.passwordSubmitting = true;
  $("password-dialog-submit").disabled = true;
  $("password-dialog-cancel").disabled = true;
  $("password-dialog-message").textContent = "正在保存新密码…";
  try {
    const result = await api(`/v1/admin/users/${encodeURIComponent(state.passwordUserId)}/password/reset`, {
      method: "POST",
      body: { password },
    });
    const username = state.passwordUserName;
    state.passwordSubmitting = false;
    $("password-dialog-submit").disabled = false;
    $("password-dialog-cancel").disabled = false;
    closePasswordDialog();
    message("dashboard-message", "已为“" + username + "”设置新密码，并撤销 " + (result.revoked || 0) + " 个旧会话。");
    await Promise.all([loadUsers(), loadAuditLogs()]);
  } catch (error) {
    state.passwordSubmitting = false;
    $("password-dialog-submit").disabled = false;
    $("password-dialog-cancel").disabled = false;
    $("password-dialog-message").textContent = error.message || "操作失败，请稍后重试";
  }
});

$("send-admin-code").addEventListener("click", () => sendCode().catch((error) => message("login-message", error.message)));
$("admin-login-form").addEventListener("submit", (event) => login(event).catch((error) => message("login-message", error.message)));
$("refresh-users").addEventListener("click", () => loadUsers().catch((error) => message("dashboard-message", error.message)));
$("refresh-audit").addEventListener("click", () => loadAuditLogs().catch((error) => message("dashboard-message", error.message)));
$("users-body").addEventListener("click", (event) => userAction(event).catch((error) => message("dashboard-message", error.message)));
$("admin-logout").addEventListener("click", async () => {
  await api("/v1/auth/logout", { method: "POST", body: { refreshToken: state.refreshToken } }, false).catch(() => {});
  window.location.reload();
});
