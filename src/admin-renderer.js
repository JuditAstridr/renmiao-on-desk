"use strict";

const PAGE_SIZE = 50;
const state = { page: 0, total: 0, rows: [], busy: false };
const $ = (id) => document.getElementById(id);

const ACTION_LABELS = {
  force_password_reset: "强制重置密码",
  suspend_user: "封禁用户",
  delete_user: "注销用户",
  update_user: "更新用户",
  revoke_user_sessions: "撤销会话",
};

function safe(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[char]);
}

function setMessage(value = "", success = false) {
  const node = $("dashboard-message");
  node.textContent = value;
  node.classList.toggle("success", success);
}

function errorMessage(error) {
  if (error && error.message) return error.message;
  return "操作失败，请稍后重试";
}

function statusLabel(status) {
  return ({ active: "正常", pending: "待验证", suspended: "已封禁", deleted: "已注销" })[status] || status || "未知";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function renderStats() {
  const pageCount = state.rows.length;
  const start = state.total === 0 ? 0 : state.page * PAGE_SIZE + 1;
  const end = state.total === 0 ? 0 : start + pageCount - 1;
  $("total-count").textContent = String(state.total);
  $("page-count").textContent = String(pageCount);
  $("range-count").textContent = `${start}–${end}`;
  $("page-info").textContent = `第 ${state.total === 0 ? 1 : state.page + 1} 页`;
  $("previous-page").disabled = state.busy || state.page <= 0;
  $("next-page").disabled = state.busy || (state.page + 1) * PAGE_SIZE >= state.total;
}

function userActions(user) {
  const buttons = [];
  if (user.status === "suspended" || user.status === "deleted") {
    buttons.push(`<button data-action="activate" data-id="${safe(user.id)}">${user.status === "deleted" ? "恢复" : "解封"}</button>`);
  } else if (user.status !== "deleted") {
    buttons.push(`<button data-action="suspend" data-id="${safe(user.id)}">封禁</button>`);
  }
  if (user.status !== "deleted") {
    buttons.push(`<button data-action="delete" data-id="${safe(user.id)}">注销</button>`);
  }
  if (user.status === "active") {
    buttons.push(`<button data-action="reset" data-id="${safe(user.id)}">重置密码</button>`);
  }
  if (user.status !== "deleted" && user.status !== "suspended") {
    buttons.push(`<button data-action="edit" data-id="${safe(user.id)}" data-username="${safe(user.username)}" data-email="${safe(user.email)}">编辑</button>`);
  }
  buttons.push(`<button data-action="revoke" data-id="${safe(user.id)}">撤销会话</button>`);
  return buttons.join("");
}

function renderUsers() {
  $("users-body").innerHTML = state.rows.map((user) => `<tr>
    <td>${safe(user.username)}</td>
    <td>${safe(user.email)}</td>
    <td><span class="status ${safe(user.status)}">${safe(statusLabel(user.status))}</span></td>
    <td>${safe(formatDate(user.createdAt))}</td>
    <td>${safe(formatDate(user.lastLoginAt))}</td>
    <td class="row-actions">${userActions(user)}</td>
  </tr>`).join("") || `<tr><td colspan="6" class="empty">暂无普通用户</td></tr>`;
  renderStats();
}

async function loadUsers() {
  state.busy = true;
  renderStats();
  try {
    const data = await window.adminAPI.listUsers({
      query: $("user-query").value,
      status: $("user-status").value,
      limit: PAGE_SIZE,
      offset: state.page * PAGE_SIZE,
    });
    state.rows = Array.isArray(data.rows) ? data.rows : [];
    state.total = Number.isFinite(Number(data.total)) ? Number(data.total) : state.rows.length;
    if (state.page > 0 && state.page * PAGE_SIZE >= state.total) {
      state.page -= 1;
      state.busy = false;
      return loadUsers();
    }
    renderUsers();
  } catch (error) {
    state.rows = [];
    state.total = 0;
    renderUsers();
    setMessage(errorMessage(error));
  } finally {
    state.busy = false;
    renderStats();
  }
}

async function loadAuditLogs() {
  try {
    const data = await window.adminAPI.listAuditLogs({ limit: 100, offset: 0 });
    $("audit-body").innerHTML = (Array.isArray(data.rows) ? data.rows : []).map((log) => `<tr>
      <td>${safe(formatDate(log.created_at))}</td>
      <td>${safe(ACTION_LABELS[log.action] || log.action)}</td>
      <td>${safe(log.target_user_id || "—")}</td>
      <td>${safe(log.ip || "—")}</td>
      <td>${safe(JSON.stringify(log.metadata || {}))}</td>
    </tr>`).join("") || `<tr><td colspan="5" class="empty">暂无日志</td></tr>`;
  } catch (error) {
    $("audit-body").innerHTML = `<tr><td colspan="5" class="empty">${safe(errorMessage(error))}</td></tr>`;
  }
}

async function refreshAll(successMessage = "") {
  await Promise.all([loadUsers(), loadAuditLogs()]);
  if (successMessage) setMessage(successMessage, true);
}

async function userAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button || state.busy) return;
  const action = button.dataset.action;
  const userId = button.dataset.id;
  if (["delete", "suspend"].includes(action)) {
    const text = action === "delete" ? "确认注销这个账户？注销后用户将无法登录。" : "确认封禁这个账户？";
    if (!window.confirm(text)) return;
  }
  if (action === "reset" && !window.confirm("确认向用户邮箱发送密码重置验证码？")) return;
  try {
    if (action === "revoke") {
      const result = await window.adminAPI.revokeUserSessions({ userId });
      await refreshAll(`已撤销 ${result.revoked || 0} 个会话。`);
      return;
    }
    if (action === "reset") {
      const result = await window.adminAPI.resetPasswordRequest({ userId });
      await refreshAll(`密码重置验证码已发送至 ${result.email || "用户绑定邮箱"}。`);
      return;
    }
    if (action === "edit") {
      const username = window.prompt("用户名", button.dataset.username || "");
      if (username === null) return;
      const email = window.prompt("绑定邮箱（必须是 @ruc.edu.cn）", button.dataset.email || "");
      if (email === null) return;
      const result = await window.adminAPI.updateUser({ userId, patch: { username, email } });
      await refreshAll(result.emailVerification ? "新邮箱验证码已发送，用户验证后才会恢复登录。" : "账号资料已更新。 ");
      return;
    }
    const status = action === "activate" ? "active" : action === "suspend" ? "suspended" : "deleted";
    await window.adminAPI.updateUser({ userId, patch: { status } });
    await refreshAll(status === "deleted" ? "账号已注销。" : status === "suspended" ? "账号已封禁。" : "账号已恢复。 ");
  } catch (error) {
    setMessage(errorMessage(error));
  }
}

$("refresh-users").addEventListener("click", () => {
  state.page = 0;
  refreshAll().catch((error) => setMessage(errorMessage(error)));
});
$("refresh-audit").addEventListener("click", () => loadAuditLogs().catch((error) => setMessage(errorMessage(error))));
$("previous-page").addEventListener("click", () => {
  if (state.page <= 0 || state.busy) return;
  state.page -= 1;
  loadUsers().catch((error) => setMessage(errorMessage(error)));
});
$("next-page").addEventListener("click", () => {
  if ((state.page + 1) * PAGE_SIZE >= state.total || state.busy) return;
  state.page += 1;
  loadUsers().catch((error) => setMessage(errorMessage(error)));
});
$("user-query").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  state.page = 0;
  refreshAll().catch((error) => setMessage(errorMessage(error)));
});
$("user-status").addEventListener("change", () => {
  state.page = 0;
  refreshAll().catch((error) => setMessage(errorMessage(error)));
});
$("users-body").addEventListener("click", (event) => userAction(event).catch((error) => setMessage(errorMessage(error))));
$("admin-logout").addEventListener("click", () => window.adminAPI.logout().catch((error) => setMessage(errorMessage(error))));

renderStats();
refreshAll().catch((error) => setMessage(errorMessage(error)));
