"use strict";

function createEmailer(config, { fetchImpl = globalThis.fetch } = {}) {
  function escapeHtml(value) {
    return String(value || "").replace(/[&<>\"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
    })[char]);
  }

  async function send({ to, subject, text, html }) {
    if (!config.resendApiKey) {
      throw new Error("RESEND_API_KEY is not configured; verification codes are sent by email and are never printed to the terminal");
    }
    if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable for email delivery");
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`email delivery failed (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return { delivered: true };
  }

  return {
    sendVerificationCode({ to, code, purpose, username = "" }) {
      const action = purpose === "admin_login"
        ? "管理员登录"
        : purpose === "register"
          ? "完成 renmiao 账号注册"
          : purpose === "reset_password"
            ? "重置 renmiao 账号密码"
            : purpose === "change_email"
              ? "验证新的 renmiao 绑定邮箱"
              : "登录 renmiao";
      const greeting = username ? `你好，${username}！\n\n` : "你好！\n\n";
      const safeUsername = escapeHtml(username);
      const safeCode = escapeHtml(code);
      return send({
        to,
        subject: `renmiao｜${action}验证码`,
        text: `${greeting}你的验证码是：${code}\n\n验证码有效期为 10 分钟。如非本人操作，请忽略此邮件。`,
        html: `${safeUsername ? `<p>你好，${safeUsername}！</p>` : "<p>你好！</p>"}<p>你的验证码是：</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${safeCode}</p><p>验证码有效期为 10 分钟。如非本人操作，请忽略此邮件。</p>`,
      });
    },
  };
}

module.exports = { createEmailer };
