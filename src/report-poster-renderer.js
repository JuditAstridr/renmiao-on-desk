"use strict";

// Small dependency-free poster renderer.  Keeping the drawing in the Study
// window means report generation is deterministic and the main process only
// handles the user-approved save-to-file operation.

const W = 1080;
const H = 1620;

function text(ctx, value, x, y, size, color = "#2b211d", weight = "400", align = "left") {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textAlign = align;
  ctx.fillText(String(value == null ? "" : value), x, y);
}

function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, radius);
  } else {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function drawCat(ctx, x, y, scale, accent) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = accent || "#d97757";
  ctx.beginPath();
  ctx.moveTo(0, 35); ctx.lineTo(18, 0); ctx.lineTo(36, 25);
  ctx.lineTo(78, 25); ctx.lineTo(96, 0); ctx.lineTo(114, 35);
  ctx.lineTo(108, 110); ctx.quadraticCurveTo(57, 140, 6, 110); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff8f2";
  ctx.beginPath(); ctx.ellipse(38, 65, 8, 11, 0, 0, Math.PI * 2); ctx.ellipse(76, 65, 8, 11, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2b211d";
  ctx.beginPath(); ctx.arc(40, 67, 3, 0, Math.PI * 2); ctx.arc(74, 67, 3, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#2b211d"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(57, 78, 10, 0.15, Math.PI - 0.15); ctx.stroke();
  ctx.restore();
}

async function draw(canvas, model = {}) {
  if (!canvas || typeof canvas.getContext !== "function") throw new Error("poster canvas unavailable");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("poster canvas context unavailable");
  ctx.fillStyle = "#fff8f2";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#f6dfd0";
  ctx.beginPath(); ctx.arc(920, 170, 210, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fcebdc";
  ctx.beginPath(); ctx.arc(130, 1420, 260, 0, Math.PI * 2); ctx.fill();

  text(ctx, model.title || "Study report", 80, 125, 58, "#2b211d", "700");
  text(ctx, model.range || "", 84, 175, 26, "#8e6e61", "400");
  drawCat(ctx, 820, 250, 1.35, model.petTint || "#d97757");

  const stats = Array.isArray(model.stats) ? model.stats : [];
  const cardW = 220;
  stats.slice(0, 4).forEach((stat, index) => {
    const x = 80 + index * 245;
    roundedRect(ctx, x, 300, cardW, 150, 20, "#ffffff", "#efd8cb");
    text(ctx, stat.value, x + 22, 365, 36, stat.cls === "accent" ? "#d97757" : "#2b211d", "700");
    text(ctx, stat.label, x + 22, 407, 20, "#8e6e61", "400");
  });

  text(ctx, model.chartTitle || "Focus", 80, 535, 30, "#2b211d", "700");
  const daily = Array.isArray(model.daily) ? model.daily : [];
  const max = Math.max(1, ...daily.map((entry) => Number(entry.minutes) || 0));
  const chartX = 90;
  const chartY = 850;
  const chartH = 260;
  const chartW = 900;
  const barW = daily.length ? Math.max(8, Math.min(68, chartW / daily.length - 10)) : 30;
  ctx.strokeStyle = "#efd8cb"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(chartX, chartY); ctx.lineTo(chartX + chartW, chartY); ctx.stroke();
  daily.forEach((entry, index) => {
    const value = Number(entry.minutes) || 0;
    const height = Math.round((value / max) * chartH);
    const x = chartX + (index + 0.5) * (chartW / Math.max(1, daily.length)) - barW / 2;
    roundedRect(ctx, x, chartY - height, barW, Math.max(3, height), 8, "#d97757");
    if (daily.length <= 14 || index % Math.ceil(daily.length / 10) === 0) {
      const date = new Date(entry.day);
      text(ctx, `${date.getMonth() + 1}/${date.getDate()}`, x + barW / 2, chartY + 32, 16, "#8e6e61", "400", "center");
    }
  });
  text(ctx, `${model.totalLabel || ""}`, 90, 910, 18, "#8e6e61");

  text(ctx, model.factsTitle || "Highlights", 80, 1215, 30, "#2b211d", "700");
  const facts = Array.isArray(model.facts) ? model.facts : [];
  if (!facts.length) facts.push(model.noData || "No completed focus sessions yet.");
  facts.slice(0, 5).forEach((fact, index) => {
    roundedRect(ctx, 80, 1250 + index * 48, 900, 36, 10, index % 2 ? "#fff" : "#fceddf");
    text(ctx, `• ${fact}`, 100, 1275 + index * 48, 19, "#6e5147");
  });
  text(ctx, model.footer || "", 80, 1550, 18, "#8e6e61");
  return canvas;
}

const api = { W, H, draw };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.ClawdReportPoster = api;
