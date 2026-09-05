"use strict";

const ADMIN_EMAIL = "judit.astridr@gmail.com";
const state = { view: "login", loginMode: "password", adminLogin: false, adminCodeSent: false, challengeId: "", challengePurpose: "", resend: null };
const $ = (id) => document.getElementById(id);

function setMessage(value = "", success = false) {
  const node = $("message");
  node.textContent = value;
  node.classList.toggle("success", success);
}

function errorMessage(error) {
  return error && error.message ? error.message : "操作失败，请稍后重试";
}

function setView(view) {
  state.view = view;
  for (const id of ["login", "register", "verify", "reset", "email-verify"]) $(`${id}-view`).hidden = id !== view;
  $("title").textContent = view === "login" ? "登录 renmiao" : view === "register" ? "创建账号" : view === "verify" ? "验证邮箱" : view === "reset" ? "重置密码" : "验证绑定邮箱";
  $("subtitle").textContent = view === "login" ? "使用人大邮箱继续使用桌宠。" : view === "register" ? "注册后即可使用 renmiao。" : view === "verify" ? "验证码只对本次操作有效。" : view === "reset" ? "使用邮箱验证码设置新密码。" : "完成邮箱验证后即可恢复登录。";
  setMessage("");
}

function setLoginMode(mode) {
  if (state.adminLogin && mode !== "password") {
    setMessage("管理员登录需要同时使用密码和邮箱验证码。");
    mode = "password";
  }
  state.loginMode = mode;
  $("password-tab").classList.toggle("active", mode === "password");
  $("code-tab").classList.toggle("active", mode === "code");
  $("login-password-field").hidden = mode !== "password";
  $("send-login-code").hidden = mode !== "code" || state.adminLogin;
  $("login-code-field").hidden = mode !== "code" && !state.adminLogin;
  $("login-password").required = mode === "password";
  $("login-code").required = mode === "code" || (state.adminLogin && state.adminCodeSent);
  $("login-code-label").textContent = state.adminLogin ? "管理员邮箱验证码" : "验证码";
  $("login-submit").textContent = state.adminLogin
    ? (state.adminCodeSent ? "验证管理员登录" : "发送管理员验证码")
    : "登录";
  if (!state.adminLogin) setMessage("");
}

function setAdminLogin(enabled, announce = true) {
  state.adminLogin = enabled;
  state.adminCodeSent = false;
  state.challengeId = "";
  state.challengePurpose = "";
  setLoginMode("password");
  $("subtitle").textContent = enabled ? "管理员登录需要密码和邮箱验证码。" : "使用人大邮箱继续使用桌宠。";
  if (announce) setMessage(enabled ? "请输入管理员密码，点击按钮发送邮箱验证码。" : "");
}

function isAdminEmail() {
  return $("login-email").value.trim().toLowerCase() === ADMIN_EMAIL;
}

function startCooldown(button, seconds) {
  if (state.resend) clearInterval(state.resend);
  let remaining = seconds;
  button.disabled = true;
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = `${original}（${remaining}s）`;
  state.resend = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(state.resend);
      state.resend = null;
      button.disabled = false;
      button.textContent = original;
    } else button.textContent = `${original}（${remaining}s）`;
  }, 1000);
}

async function registerRequest(event) {
  event.preventDefault();
  const password = $("register-password").value;
  if (password !== $("register-password-confirm").value) { setMessage("两次输入的密码不一致"); return; }
  try {
    const result = await window.authAPI.registerRequest({
      username: $("register-username").value,
      email: $("register-email").value,
      password,
    });
    state.challengeId = result.challengeId;
    state.challengePurpose = "register";
    $("verify-hint").textContent = `验证码已发送至 ${result.email}，有效期约 10 分钟。`;
    setView("verify");
    startCooldown($("resend-code"), 60);
  } catch (error) { setMessage(errorMessage(error)); }
}

async function verifyRegistration(event) {
  event.preventDefault();
  try {
    await window.authAPI.registerVerify({ challengeId: state.challengeId, code: $("verify-code").value });
  } catch (error) { setMessage(errorMessage(error)); }
}

async function sendLoginCode() {
  try {
    const result = await window.authAPI.loginCodeRequest({ email: $("login-email").value });
    state.challengeId = result.challengeId;
    state.challengePurpose = "login";
    setMessage(`验证码已发送至 ${result.email}，有效期约 10 分钟。`, true);
    startCooldown($("send-login-code"), 60);
  } catch (error) { setMessage(errorMessage(error)); }
}

async function login(event) {
  event.preventDefault();
  try {
    if (state.adminLogin) {
      if (!state.adminCodeSent) {
        const result = await window.authAPI.adminLoginStart({
          email: $("login-email").value,
          password: $("login-password").value,
        });
        state.challengeId = result.challengeId;
        state.challengePurpose = "admin_login";
        state.adminCodeSent = true;
        setLoginMode("password");
        setMessage("验证码已发送至 " + (result.email || "管理员邮箱") + "，有效期约 10 分钟。", true);
        return;
      }
      await window.authAPI.adminLoginVerify({
        challengeId: state.challengeId,
        code: $("login-code").value,
      });
      return;
    }
    if (state.loginMode === "password") {
      await window.authAPI.loginPassword({ email: $("login-email").value, password: $("login-password").value });
    } else {
      if (!state.challengeId) { setMessage("请先发送验证码"); return; }
      await window.authAPI.loginCodeVerify({ challengeId: state.challengeId, code: $("login-code").value });
    }
  } catch (error) { setMessage(errorMessage(error)); }
}

async function resetRequest(event) {
  event.preventDefault();
  try {
    const result = await window.authAPI.resetPasswordRequest({ email: $("reset-email").value });
    state.challengeId = result.challengeId;
    state.challengePurpose = "reset_password";
    $("reset-request-form").hidden = true;
    $("reset-confirm-form").hidden = false;
    setMessage(`验证码已发送至 ${result.email}，有效期约 10 分钟。`, true);
  } catch (error) { setMessage(errorMessage(error)); }
}

async function resetConfirm(event) {
  event.preventDefault();
  if ($("reset-password").value !== $("reset-password-confirm").value) {
    setMessage("两次输入的新密码不一致");
    return;
  }
  try {
    await window.authAPI.resetPassword({
      challengeId: state.challengeId,
      code: $("reset-code").value,
      password: $("reset-password").value,
    });
  } catch (error) { setMessage(errorMessage(error)); }
}

async function verifyEmailChange(event) {
  event.preventDefault();
  try {
    await window.authAPI.verifyEmailChange({
      email: $("email-verify-email").value,
      code: $("email-verify-code").value,
    });
    setView("login");
    setMessage("邮箱验证成功，现在可以登录了。", true);
  } catch (error) { setMessage(errorMessage(error)); }
}

$("password-tab").addEventListener("click", () => setLoginMode("password"));
$("code-tab").addEventListener("click", () => setLoginMode("code"));
$("login-form").addEventListener("submit", (event) => login(event));
$("send-login-code").addEventListener("click", () => sendLoginCode());
$("register-form").addEventListener("submit", (event) => registerRequest(event));
$("verify-form").addEventListener("submit", (event) => verifyRegistration(event));
$("reset-request-form").addEventListener("submit", (event) => resetRequest(event));
$("reset-confirm-form").addEventListener("submit", (event) => resetConfirm(event));
$("email-verify-form").addEventListener("submit", (event) => verifyEmailChange(event));
$("show-register").addEventListener("click", () => setView("register"));
$("show-reset").addEventListener("click", () => setView("reset"));
$("show-email-verify").addEventListener("click", () => setView("email-verify"));
$("show-admin-login").addEventListener("click", () => {
  setView("login");
  $("login-email").value = ADMIN_EMAIL;
  setAdminLogin(true);
  $("login-password").focus();
});
$("login-email").addEventListener("input", () => {
  const adminEmail = isAdminEmail();
  if (adminEmail !== state.adminLogin) setAdminLogin(adminEmail, false);
});
for (const button of document.querySelectorAll("[data-view]")) button.addEventListener("click", () => setView(button.dataset.view));
$("resend-code").addEventListener("click", async () => {
  if (state.challengePurpose !== "register") return;
  try {
    const result = await window.authAPI.registerRequest({
      username: $("register-username").value,
      email: $("register-email").value,
      password: $("register-password").value,
    });
    state.challengeId = result.challengeId;
    setMessage(`验证码已重新发送至 ${result.email}。`, true);
    startCooldown($("resend-code"), 60);
  } catch (error) { setMessage(errorMessage(error)); }
});

setLoginMode("password");
