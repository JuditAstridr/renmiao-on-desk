"use strict";

const PAGE_SIZE = 50;
const state = {
  page: 0,
  total: 0,
  rows: [],
  busy: false,
  passwordUserId: "",
  passwordUserName: "",
  passwordSubmitting: false,
  profileUserId: "",
  profileUserName: "",
  profileUpdatedAt: "",
  profileSubmitting: false,
};
const $ = (id) => document.getElementById(id);

const ACTION_LABELS = {
  force_password_reset: "强制要求用户重置密码",
  admin_reset_password: "管理员重置密码",
  suspend_user: "封禁用户",
  delete_user: "注销用户",
  update_user: "更新用户",
  revoke_user_sessions: "撤销会话",
  update_user_profile: "更新账号场景与学习资料",
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
    buttons.push(`<button data-action="reset" data-id="${safe(user.id)}" data-username="${safe(user.username)}">重置密码</button>`);
  }
  if (user.status !== "deleted" && user.status !== "suspended") {
    buttons.push(`<button data-action="edit" data-id="${safe(user.id)}" data-username="${safe(user.username)}" data-email="${safe(user.email)}">编辑</button>`);
  }
  buttons.push(`<button data-action="revoke" data-id="${safe(user.id)}">撤销会话</button>`);
  buttons.push(`<button data-action="profile" data-id="${safe(user.id)}" data-username="${safe(user.username)}">资料</button>`);
  return buttons.join("");
}

function renderUsers() {
  $("users-body").innerHTML = state.rows.map((user) => `<tr>
    <td>${safe(user.username)}</td>
    <td>${safe(user.email)}</td>
    <td><span class="status ${safe(user.status)}">${safe(statusLabel(user.status))}</span></td>
    <td>${safe(formatDate(user.createdAt))}</td>
    <td>${safe(formatDate(user.lastLoginAt))}</td>
    <td>${safe(user.profileSummary?.themeId || "renmi")}</td>
    <td>${safe(`${user.profileSummary?.taskCount || 0} 个 / ${user.profileSummary?.pointsTotal || 0} 分`)}</td>
    <td class="row-actions">${userActions(user)}</td>
  </tr>`).join("") || `<tr><td colspan="8" class="empty">暂无普通用户</td></tr>`;
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
  if (action === "reset") {
    openPasswordDialog(button.dataset.id, button.dataset.username || "该用户");
    return;
  }
  if (action === "profile") {
    await openProfileDialog(userId, button.dataset.username || "该用户");
    return;
  }
  try {
    if (action === "revoke") {
      const result = await window.adminAPI.revokeUserSessions({ userId });
      await refreshAll(`已撤销 ${result.revoked || 0} 个会话。`);
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
    const result = await window.adminAPI.resetPassword({ userId: state.passwordUserId, password });
    const username = state.passwordUserName;
    state.passwordSubmitting = false;
    $("password-dialog-submit").disabled = false;
    $("password-dialog-cancel").disabled = false;
    closePasswordDialog();
    await refreshAll("已为“" + username + "”设置新密码，并撤销 " + (result.revoked || 0) + " 个旧会话。");
  } catch (error) {
    state.passwordSubmitting = false;
    $("password-dialog-submit").disabled = false;
    $("password-dialog-cancel").disabled = false;
    $("password-dialog-message").textContent = errorMessage(error);
  }
});

async function openProfileDialog(userId, username) {
  state.profileUserId = userId;
  state.profileUserName = username;
  state.profileSubmitting = false;
  $("profile-dialog-user").textContent = `正在编辑“${username}”的云端桌宠与学习资料。`;
  $("profile-dialog-message").textContent = "正在加载…";
  $("profile-dialog-message").classList.remove("success");
  $("profile-dialog").hidden = false;
  try {
    const result = await window.adminAPI.getUserProfile({ userId });
    const profile = result.profile || {};
    const pet = profile.pet || {};
    $("profile-theme-id").value = pet.themeId || "renmi";
    $("profile-variant-id").value = pet.variantId || "default";
    $("profile-tint-id").value = pet.tintId || "none";
    $("profile-accessory-id").value = pet.accessoryId || "none";
    $("profile-holiday-enabled").checked = pet.holidayAccessoryEnabled === true;
    $("profile-idle-visual").value = pet.idleVisual || "";
    $("profile-study-json").value = JSON.stringify(profile.study || {}, null, 2);
    state.profileUpdatedAt = result.profileUpdatedAt || "";
    $("profile-dialog-message").textContent = "可以直接修改；保存时服务端会再次校验内容。";
  } catch (error) {
    $("profile-dialog-message").textContent = errorMessage(error);
  }
}

function closeProfileDialog() {
  if (state.profileSubmitting) return;
  $("profile-dialog").hidden = true;
  state.profileUserId = "";
  state.profileUserName = "";
  state.profileUpdatedAt = "";
}

$("profile-dialog-cancel").addEventListener("click", closeProfileDialog);
$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.profileSubmitting) return;
  let study;
  try {
    study = JSON.parse($("profile-study-json").value || "{}");
  } catch {
    $("profile-dialog-message").textContent = "学习资料必须是合法 JSON。";
    return;
  }
  state.profileSubmitting = true;
  $("profile-dialog-submit").disabled = true;
  $("profile-dialog-cancel").disabled = true;
  $("profile-dialog-message").textContent = "正在保存云端资料…";
  try {
    await window.adminAPI.updateUserProfile({
      userId: state.profileUserId,
      expectedUpdatedAt: state.profileUpdatedAt,
      profile: {
        version: 1,
        pet: {
          themeId: $("profile-theme-id").value,
          variantId: $("profile-variant-id").value,
          tintId: $("profile-tint-id").value,
          accessoryId: $("profile-accessory-id").value,
          holidayAccessoryEnabled: $("profile-holiday-enabled").checked,
          idleVisual: $("profile-idle-visual").value,
        },
        study,
      },
    });
    const username = state.profileUserName;
    state.profileSubmitting = false;
    $("profile-dialog-submit").disabled = false;
    $("profile-dialog-cancel").disabled = false;
    closeProfileDialog();
    await refreshAll(`已保存“${username}”的云端桌宠、任务和积分资料。`);
  } catch (error) {
    state.profileSubmitting = false;
    $("profile-dialog-submit").disabled = false;
    $("profile-dialog-cancel").disabled = false;
    $("profile-dialog-message").textContent = errorMessage(error);
  }
});

renderStats();
refreshAll().catch((error) => setMessage(errorMessage(error)));
