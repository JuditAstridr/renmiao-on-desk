"use strict";

// ── Report poster renderer v7 ──
//
// Plain browser script loaded by dashboard.html. Draws a 1080×1620 cream
// poster from a prepared model. Typography was bumped globally for readability;
// the four stat modules each carry a distinct colour accent and a big kit icon;
// the display font (YEFONTXiaoShiTou) is used for headings, the pet bubble and
// the big stat numbers. Tomato-kit stickers are sprinkled at low opacity as
// background accents (like the soft rings), while two act as section markers.
// draw() returns a Promise resolved once the mood-frame pet is composited.

(function attachReportPoster() {
  const W = 1080;
  const H = 1620;
  const PAD = 64;
  const FONT_STACK = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", Roboto, Helvetica, Arial, sans-serif";
  const DISPLAY_FAMILY = "\"YEFONTXiaoShiTou\", \"PingFang SC\", \"Microsoft YaHei\", -apple-system, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif";

  const RED = "#EF4D3C";
  const RED_DEEP = "#D93A2E";
  const RED_TINT = "#FFE6DE";
  const RED_LINE = "#FFD8CC";
  const CREAM = "#FAFAFA";
  const INK = "#333333";
  const MUTED = "#9A8F8A";
  const WHITE = "#ffffff";
  // Distinct colourful accents for the four stat modules.
  const DEEP = ["#E8443A", "#F0970A", "#12A15E", "#7A55D6"];
  const BRIGHT = ["#FF7A45", "#FFC24B", "#EF4D3C", "#FFD3C2", "#7CC4FF", "#B79BFF"];
  // Soft, desaturated background decoration tones (for the scattered accents).
  const DECOR_SOFT = ["#f3b3a0", "#f6d9a0", "#efb8b0", "#f2d7cc", "#b9cde9", "#d2c6ee"];
  const TAG_CHART = "#3AA6DD";
  const TAG_FACTS = "#9B6FE8";

  const BAND_H = 198;
  const STRIP_Y = BAND_H;
  const STRIP_H = 258;
  const STRIP_BOTTOM = STRIP_Y + STRIP_H;

  // Font sizes (px) — enlarged across the board.
  const S = {
    brand: 26, title: 60, range: 34,
    statLabel: 23, statValue: 66,
    section: 30, factsRow: 27, day: 20,
    bubble: 28, footer: 26, noData: 40,
  };

  let drawToken = 0;

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function drawText(ctx, textStr, x, y, opts) {
    const size = opts.size || S.factsRow;
    const weight = opts.weight || 600;
    const color = opts.color || INK;
    const family = opts.family || FONT_STACK;
    ctx.save();
    ctx.font = `${weight} ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.textAlign = opts.align || "left";
    ctx.textBaseline = opts.baseline || "alphabetic";
    if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
    ctx.fillText(textStr, x, y);
    ctx.restore();
  }

  function fitText(ctx, textStr, x, y, maxWidth, size, opts) {
    const weight = opts.weight || 600;
    const color = opts.color || INK;
    const family = opts.family || FONT_STACK;
    ctx.save();
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let used = size;
    ctx.font = `${weight} ${used}px ${family}`;
    while (used > 22 && ctx.measureText(textStr).width > maxWidth) {
      used -= 2;
      ctx.font = `${weight} ${used}px ${family}`;
    }
    ctx.fillText(textStr, x, y);
    ctx.restore();
    return used;
  }

  function truncate(textStr, maxChars) {
    const value = String(textStr == null ? "" : textStr);
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars - 1)}\u2026`;
  }

  function wrapLines(ctx, text, maxWidth, size, weight, family) {
    ctx.save();
    ctx.font = `${weight || 600} ${size}px ${family || FONT_STACK}`;
    const out = [];
    let current = "";
    for (const ch of String(text)) {
      const test = current + ch;
      if (ctx.measureText(test).width > maxWidth && current) {
        out.push(current);
        current = ch;
      } else {
        current = test;
      }
    }
    if (current) out.push(current);
    ctx.restore();
    return out;
  }

  function seededRandom(seed) {
    let s = seed >>> 0;
    return function next() {
      s += 0x6D2B79F5;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function drawSparkle(ctx, x, y, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const rad = i % 2 === 0 ? r : r * 0.32;
      const a = (Math.PI / 4) * i - Math.PI / 2;
      const px = x + Math.cos(a) * rad;
      const py = y + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function sprinkle(ctx) {
    const rand = seededRandom(20260905);
    const shapes = ["dot", "dot", "ring", "cross", "sparkle"];
    const count = 150;
    ctx.save();
    for (let i = 0; i < count; i += 1) {
      const x = rand() * W;
      const y = rand() * H;
      const shape = shapes[Math.floor(rand() * shapes.length)];
      const color = BRIGHT[Math.floor(rand() * BRIGHT.length)];
      const size = 2.5 + rand() * 6;
      ctx.globalAlpha = 0.22 + rand() * 0.3;
      if (shape === "dot") {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
      } else if (shape === "ring") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, size + 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (shape === "cross") {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - size, y); ctx.lineTo(x + size, y);
        ctx.moveTo(x, y - size); ctx.lineTo(x, y + size);
        ctx.stroke();
      } else {
        drawSparkle(ctx, x, y, size * 1.6, color);
      }
    }
    ctx.restore();
  }

  // Low-opacity tomato-kit stickers used like the soft rings: pure background.
  function drawTomatoBackdrop(ctx, imgs) {
    if (!Array.isArray(imgs) || imgs.length === 0) return;
    const anchors = [
      { x: 300, y: 330, w: 250, a: 0.13 },   // behind/above pet strip right
      { x: 90, y: STRIP_BOTTOM + 150, w: 200, a: 0.12 },
      { x: W - PAD - 120, y: STRIP_BOTTOM + 80, w: 180, a: 0.14 },
      { x: 150, y: H - 120, w: 200, a: 0.11 },
      { x: W - PAD - 150, y: H - 110, w: 190, a: 0.11 },
    ];
    ctx.save();
    imgs.forEach((img, index) => {
      const a = anchors[index % anchors.length];
      if (!img || !img.naturalWidth) return;
      const h = a.w * (img.naturalHeight / img.naturalWidth);
      ctx.globalAlpha = a.a;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, a.x - a.w / 2, a.y - h / 2, a.w, h);
    });
    ctx.restore();
  }

  function decorate(ctx, bgImgs) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = RED_LINE;
    ctx.beginPath();
    ctx.arc(W + 20, BAND_H + 90, 230, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fdeedd";
    ctx.beginPath();
    ctx.arc(-60, H - 280, 200, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const dots = [
      [PAD + 14, 500, 8, BRIGHT[3]], [W - PAD - 18, 540, 6, BRIGHT[2]],
      [PAD + 22, 1010, 6, BRIGHT[4]], [W - PAD - 34, 900, 8, BRIGHT[1]],
      [W / 2 + 180, 500, 6, BRIGHT[5]], [W / 2 - 200, 1030, 7, BRIGHT[0]],
      [PAD + 8, 300, 5, BRIGHT[0]], [W - PAD - 12, 280, 5, BRIGHT[3]],
      [W - PAD - 20, 620, 6, BRIGHT[5]], [PAD + 16, 780, 6, BRIGHT[2]],
      [W / 2 + 120, 640, 5, BRIGHT[1]], [W / 2 - 130, 780, 6, BRIGHT[4]],
    ];
    ctx.save();
    for (const [x, y, r, color] of dots) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    sprinkle(ctx);
    drawTomatoBackdrop(ctx, bgImgs);
  }

  function textWidth(ctx, text, size, weight, family) {
    ctx.save();
    ctx.font = `${weight || 600} ${size}px ${family || FONT_STACK}`;
    const w = ctx.measureText(String(text)).width;
    ctx.restore();
    return w;
  }

  // Shrink text to fit maxWidth, then draw it centred on the given x-midline.
  function drawCenteredFit(ctx, text, midX, y, maxWidth, size, opts) {
    const weight = opts.weight || 600;
    const color = opts.color || INK;
    const family = opts.family || FONT_STACK;
    ctx.save();
    let used = size;
    ctx.font = `${weight} ${used}px ${family}`;
    while (used > 18 && ctx.measureText(String(text)).width > maxWidth) {
      used -= 2;
      ctx.font = `${weight} ${used}px ${family}`;
    }
    const w = ctx.measureText(String(text)).width;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(String(text), midX - w / 2, y);
    ctx.restore();
    return used;
  }

  function drawStats(ctx, stats, top, icons) {
    const cardW = (W - 2 * PAD - 24) / 2;
    const cardH = 168;
    const rowGap = 20;
    (stats || []).slice(0, 4).forEach((item, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = PAD + col * (cardW + 24);
      const y = top + row * (cardH + rowGap);
      const accent = DEEP[index % DEEP.length];
      ctx.save();
      ctx.shadowColor = "rgba(40, 20, 20, 0.10)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 6;
      ctx.fillStyle = WHITE;
      roundedRect(ctx, x, y, cardW, cardH, 20);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.fillStyle = accent;
      roundedRect(ctx, x, y, cardW, 8, 4);
      ctx.fill();
      ctx.restore();

      // Left column: the module icon, vertically centred.
      const icon = Array.isArray(icons) ? icons[index] : null;
      const iconH = icon && icon.naturalWidth ? 62 : 0;
      const iconW = iconH ? iconH * (icon.naturalWidth / icon.naturalHeight) : 0;
      const regionX = x + (iconW ? 26 + iconW + 26 : 34);
      const regionW = x + cardW - 24 - regionX;
      if (iconW) {
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(icon, x + 20, y + (cardH - iconH) / 2, iconW, iconH);
        ctx.restore();
      }
      // Title: grey, left aligned, dropped closer to the vertical middle.
      drawText(ctx, String(item.label || ""), regionX, y + (cardH / 2) - 26, {
        size: 27,
        weight: 700,
        color: "#7A6B68",
      });
      // Value: coloured, left aligned, vertical position unchanged.
      fitText(ctx, String(item.value || "0"), regionX, y + (cardH / 2) + 40, regionW, 80, {
        weight: 500,
        color: accent,
        family: DISPLAY_FAMILY,
      });
    });
  }

  function drawChart(ctx, daily, areaTop, areaBottom, labelBaseline) {
    const count = daily.length;
    if (count === 0) return;
    const innerX = PAD;
    const innerW = W - 2 * PAD;
    const barGap = count > 30 ? 2 : 6;
    const barW = Math.max(2, (innerW - barGap * (count - 1)) / count);
    const areaH = areaBottom - areaTop;
    const maxMinutes = daily.reduce((acc, d) => Math.max(acc, d.minutes || 0), 0);

    ctx.save();
    ctx.fillStyle = "#FDEBE4";
    roundedRect(ctx, innerX, areaTop, innerW, areaH, 12);
    ctx.fill();
    ctx.restore();

    const grad = ctx.createLinearGradient(0, areaBottom, 0, areaTop);
    grad.addColorStop(0, RED_DEEP);
    grad.addColorStop(1, RED);

    daily.forEach((entry, index) => {
      const x = innerX + index * (barW + barGap);
      const value = Math.max(0, entry.minutes || 0);
      if (value <= 0) return;
      const h = Math.max(10, Math.round((value / Math.max(maxMinutes, 1)) * areaH));
      ctx.save();
      ctx.fillStyle = grad;
      roundedRect(ctx, x, areaBottom - h, barW, h, Math.min(6, barW / 2));
      ctx.fill();
      ctx.restore();
      const day = new Date(entry.day);
      drawText(ctx, String(day.getDate()), x, labelBaseline, {
        size: count > 30 ? 20 : 23, weight: 600, color: "#B4573A",
      });
    });
    let bestIndex = 0;
    for (let i = 1; i < count; i += 1) {
      if ((daily[i] && daily[i].minutes || 0) > (daily[bestIndex] && daily[bestIndex].minutes || 0)) bestIndex = i;
    }
    const peak = daily[bestIndex] ? daily[bestIndex].minutes : 0;
    if (peak > 0) {
      const px = innerX + bestIndex * (barW + barGap) + barW / 2;
      drawStar(ctx, px, areaBottom - Math.max(10, Math.round((peak / Math.max(maxMinutes, 1)) * areaH)) - 22, 15, BRIGHT[1]);
    }
  }

  function drawStar(ctx, cx, cy, r, color) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i += 1) {
      const rad = i % 2 === 0 ? r : r * 0.42;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const x = cx + Math.cos(a) * rad;
      const y = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFacts(ctx, facts, top, bottom) {
    const lineHeight = 44;
    const textX = PAD + 38;
    const maxRows = Math.max(1, Math.floor((bottom - top - lineHeight) / lineHeight));
    const rows = (facts || []).slice(0, maxRows);
    if (rows.length === 0) return;
    const boxH = rows.length * lineHeight + 44;
    ctx.save();
    ctx.shadowColor = "rgba(40, 20, 20, 0.07)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = WHITE;
    roundedRect(ctx, PAD, top, W - 2 * PAD, boxH, 20);
    ctx.fill();
    ctx.restore();
    rows.forEach((fact, index) => {
      const y = top + 40 + index * lineHeight;
      const color = DEEP[index % DEEP.length];
      drawText(ctx, "\u2022", PAD + 18, y, { size: 30, weight: 800, color });
      drawText(ctx, truncate(fact, 44), textX + 12, y, { size: S.factsRow, weight: 500, color: INK });
    });
  }

  function drawPetShadow(ctx, cx, bottomY, rx) {
    ctx.save();
    ctx.fillStyle = "rgba(40, 20, 20, 0.12)";
    ctx.beginPath();
    ctx.ellipse(cx, bottomY, rx, rx * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPetStamp(ctx, img, cx, cy, r, ringColor) {
    ctx.save();
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 4, 0, Math.PI * 2);
    ctx.clip();
    const inner = (r - 4) * 2;
    const iw = (img.naturalWidth || img.width) || 1;
    const ih = (img.naturalHeight || img.height) || 1;
    const scale = Math.min(inner / iw, inner / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
    ctx.restore();
  }

  function measureBubble(ctx, text, width) {
    const size = S.bubble;
    const padX = 30;
    const contentW = width - padX * 2;
    const lines = wrapLines(ctx, text, contentW, size, 600, DISPLAY_FAMILY).slice(0, 3);
    const rowH = 40;
    const textBlock = lines.length * rowH - 8;
    const boxH = Math.max(86, textBlock + 44);
    return { lines, boxH, rowH, padX };
  }

  function drawBubbleAt(ctx, metrics, x, y, width) {
    const { lines, boxH, rowH, padX } = metrics;
    ctx.save();
    ctx.shadowColor = "rgba(40, 20, 20, 0.10)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = WHITE;
    roundedRect(ctx, x, y, width, boxH, 26);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = RED_LINE;
    ctx.lineWidth = 2;
    roundedRect(ctx, x, y, width, boxH, 26);
    ctx.stroke();
    ctx.restore();
    const textBlock = lines.length * rowH - 8;
    const topPad = (boxH - textBlock) / 2;
    lines.forEach((line, index) => {
      const rowCenter = y + topPad + rowH * index + rowH / 2;
      drawText(ctx, line, x + padX, rowCenter, {
        size: S.bubble, weight: 600, color: INK, baseline: "middle", family: DISPLAY_FAMILY,
      });
    });
    const cy = y + boxH / 2;
    ctx.save();
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(x - 7, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 18, cy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return boxH;
  }

  // ── Pet tint via colour matrix ──
  // ctx.filter is not honoured by every Chromium build, so the catalog filter
  // strings ("sepia(0.8) saturate(2.2) …") are applied manually as 3×4 affine
  // matrices on RGB. If parsing fails, the pet is drawn untinted (safe fallback).
  function parseCssFilters(str) {
    const ops = [];
    const re = /([a-z-]+)\s*\(\s*(-?[0-9.]+)\s*(deg)?\s*\)/gi;
    let match;
    while ((match = re.exec(String(str)))) {
      ops.push({ name: match[1], value: Number(match[2]), deg: !!match[3] });
    }
    return ops;
  }

  function clamp255(v) {
    return v < 0 ? 0 : (v > 255 ? 255 : v);
  }

  // Returns a 3x4 row-major matrix; x' = m*x + offset.
  function identityMatrix() {
    return [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]];
  }

  // compose(a, b) = a ∘ b (apply b first, then a).
  function composeMatrix(a, b) {
    const out = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        let acc = 0;
        for (let k = 0; k < 3; k += 1) acc += a[i][k] * b[k][j];
        if (j === 3) acc += a[i][3];
        out[i][j] = acc;
      }
    }
    return out;
  }

  function opMatrix(op) {
    const t = op.deg ? (op.value * Math.PI) / 180 : op.value;
    const I = identityMatrix();
    if (op.name === "brightness") {
      return [[t, 0, 0, 0], [0, t, 0, 0], [0, 0, t, 0]];
    }
    if (op.name === "contrast") {
      return [[t, 0, 0, (0.5 - 0.5 * t) * 255], [0, t, 0, (0.5 - 0.5 * t) * 255], [0, 0, t, (0.5 - 0.5 * t) * 255]];
    }
    if (op.name === "grayscale") {
      const s = 1 - t;
      return [
        [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s, 0],
        [0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s, 0],
        [0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s, 0],
      ];
    }
    if (op.name === "sepia") {
      const s = 1 - t;
      return [
        [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0],
        [0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0],
        [0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0],
      ];
    }
    if (op.name === "saturate") {
      return [
        [0.213 + 0.787 * t, 0.715 - 0.715 * t, 0.072 - 0.072 * t, 0],
        [0.213 - 0.213 * t, 0.715 + 0.285 * t, 0.072 - 0.072 * t, 0],
        [0.213 - 0.213 * t, 0.715 - 0.715 * t, 0.072 + 0.928 * t, 0],
      ];
    }
    if (op.name === "hue-rotate") {
      const c = Math.cos(t);
      const s = Math.sin(t);
      return [
        [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928, 0],
        [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283, 0],
        [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072, 0],
      ];
    }
    return I;
  }

  function filterMatrix(str) {
    let m = identityMatrix();
    for (const op of parseCssFilters(str)) {
      m = composeMatrix(opMatrix(op), m);
    }
    return m;
  }

  function tintSourceCanvas(source, filterStr) {
    let m;
    try {
      m = filterMatrix(filterStr);
    } catch {
      return source;
    }
    const ctx = source.getContext("2d");
    const imageData = ctx.getImageData(0, 0, source.width, source.height);
    const d = imageData.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const b = d[i + 2];
      d[i] = clamp255(m[0][0] * r + m[0][1] * g + m[0][2] * b + m[0][3]);
      d[i + 1] = clamp255(m[1][0] * r + m[1][1] * g + m[1][2] * b + m[1][3]);
      d[i + 2] = clamp255(m[2][0] * r + m[2][1] * g + m[2][2] * b + m[2][3]);
    }
    ctx.putImageData(imageData, 0, 0);
    return source;
  }

  // Rasterise a pet source (raw SVG text or data URL) into an <img> that is ready
  // for canvas drawing.
  function petImageSource(petSvg) {
    if (petSvg.indexOf("data:") === 0) return petSvg;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(petSvg)}`;
  }

  // Overlay the user's current accessory (hat etc.) on the big poster pet.
  // The poster pet is much larger than the on-screen pet, so the accessory is
  // drawn at a reduced fraction of the pet's width and anchored near the top of
  // the drawn pet body.
  const ACCESSORY_SIZE_FACTOR = 0.4275;
  const ACCESSORY_Y_FACTOR = 5;
  const ACCESSORY_Y_PUSH = 8;

  function drawPetAccessory(ctx, petRect, acc) {
    return new Promise((resolve) => {
      if (!acc || !acc.svg) {
        resolve(true);
        return;
      }
      const img = new Image();
      img.onload = () => {
        try {
          const widthScale = Number(acc.widthScale) > 0 ? Number(acc.widthScale) : 1;
          const aspect = Number(acc.aspect) > 0 ? Number(acc.aspect) : 1;
          const w = petRect.w * widthScale * ACCESSORY_SIZE_FACTOR;
          const h = w / aspect;
          const x = petRect.x + (petRect.w - w) / 2;
          const y = petRect.y + (petRect.h - h) * 0.42 + (Number(acc.offsetY) || 0) * ACCESSORY_Y_FACTOR + ACCESSORY_Y_PUSH;
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(img, x, y, w, h);
          ctx.restore();
        } catch {}
        resolve(true);
      };
      img.onerror = () => resolve(true);
      img.src = acc.svg.indexOf("data:") === 0
        ? acc.svg
        : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(acc.svg)}`;
    });
  }

  function drawSectionTitle(ctx, text, baseline, tagColor) {
    ctx.save();
    ctx.fillStyle = tagColor;
    roundedRect(ctx, PAD, baseline - 20, 7, 26, 3.5);
    ctx.fill();
    ctx.restore();
    drawText(ctx, text, PAD + 24, baseline, { size: S.section, weight: 700, color: INK });
  }

  function drawDecoRight(ctx, img, baseline) {
    if (!img || !img.naturalWidth) return;
    const h = 52;
    const w = h * (img.naturalWidth / img.naturalHeight);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(img, W - PAD - w, baseline - h - 4, w, h);
    ctx.restore();
  }

  function draw(canvas, model) {
    const myToken = ++drawToken;
    if (!canvas || typeof canvas.getContext !== "function") return Promise.resolve(false);
    // Study creates the preview canvas lazily. Set the backing-store size here
    // instead of relying on HTML attributes so the 1080×1620 poster is drawn
    // at the same resolution in dev and packaged builds.
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(false);
    const m = model || {};
    const stats = Array.isArray(m.stats) ? m.stats : [];
    const facts = Array.isArray(m.facts) ? m.facts : [];
    const daily = Array.isArray(m.daily) ? m.daily : [];
    const statIcons = Array.isArray(m.statIcons) ? m.statIcons : [];
    const decoBg = Array.isArray(m.decoBg) ? m.decoBg : [];
    const hasData = stats.length > 0;
    const petSvg = typeof m.petSvg === "string" && m.petSvg.trim() ? m.petSvg : null;
    const petTint = typeof m.petTint === "string" ? m.petTint : "";
    const caption = petSvg && m.caption ? String(m.caption) : "";
    const highlightIndex = Number.isInteger(m.highlightIndex) ? m.highlightIndex : null;

    // Background
    ctx.save();
    ctx.fillStyle = CREAM;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    decorate(ctx, decoBg);

    // Header band
    const bandGrad = ctx.createLinearGradient(0, 0, 0, BAND_H);
    bandGrad.addColorStop(0, RED);
    bandGrad.addColorStop(1, RED_DEEP);
    ctx.save();
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, 0, W, BAND_H);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = WHITE;
    ctx.beginPath();
    ctx.arc(W - 60, -60, 170, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(30, BAND_H + 30, 120, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    drawText(ctx, String(m.brand || "Renmi"), PAD, 60, { size: S.brand, weight: 700, color: WHITE, alpha: 0.9, family: DISPLAY_FAMILY });
    fitText(ctx, truncate(String(m.title || "Study Report"), 34), PAD, 140, W - 2 * PAD, S.title, {
      weight: 500, color: WHITE, family: DISPLAY_FAMILY,
    });
    fitText(ctx, String(m.range || ""), PAD, 186, W - 2 * PAD, S.range, {
      weight: 600, color: WHITE, alpha: 0.95, family: DISPLAY_FAMILY,
    });

    // Pet strip
    const petBox = { x: PAD, y: STRIP_Y + 12, w: 300, h: 232 };
    const bubbleX = PAD + 344;
    const bubbleWidth = (W - PAD) - bubbleX;
    let bubbleMetrics = caption ? measureBubble(ctx, caption, bubbleWidth) : null;
    if (bubbleMetrics) {
      const bubbleTop = STRIP_Y + (STRIP_H - bubbleMetrics.boxH) / 2;
      drawBubbleAt(ctx, bubbleMetrics, bubbleX, bubbleTop, bubbleWidth);
    }
    if (petSvg) {
      drawPetShadow(ctx, petBox.x + petBox.w / 2, petBox.y + petBox.h + 8, 160);
    }
    ctx.save();
    ctx.strokeStyle = RED_LINE;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(PAD, STRIP_BOTTOM - 2);
    ctx.lineTo(W - PAD, STRIP_BOTTOM - 2);
    ctx.stroke();
    ctx.restore();

    // Content
    const statsTop = STRIP_BOTTOM + 38;
    let highlightStamp = null;
    if (!hasData) {
      drawText(ctx, String(m.noData || ""), PAD, statsTop + 250, { size: S.noData, weight: 500, color: MUTED });
    } else {
      drawStats(ctx, stats, statsTop, statIcons);
      const cardW = (W - 2 * PAD - 24) / 2;
      const cardH = 168;
      const rowGap = 20;
      if (highlightIndex != null && highlightIndex >= 0 && highlightIndex < 4) {
        const col = highlightIndex % 2;
        const row = Math.floor(highlightIndex / 2);
        highlightStamp = {
          cx: PAD + col * (cardW + 24) + cardW - 48,
          cy: statsTop + row * (cardH + rowGap) + 56,
          r: 34,
          ring: DEEP[highlightIndex % DEEP.length],
        };
      }
      const cardsBottom = statsTop + 2 * (cardH + rowGap);

      drawSectionTitle(ctx, String(m.chartTitle || ""), cardsBottom + 46, TAG_CHART);
      if (m.decoChart) drawDecoRight(ctx, m.decoChart, cardsBottom + 46);
      const areaTop = cardsBottom + 46 + 30;
      const areaBottom = areaTop + 152;
      drawChart(ctx, daily, areaTop, areaBottom, areaBottom + 38);

      drawSectionTitle(ctx, String(m.factsTitle || ""), areaBottom + 66, TAG_FACTS);
      if (m.decoFacts) drawDecoRight(ctx, m.decoFacts, areaBottom + 66);
      if (facts.length > 0) {
        drawFacts(ctx, facts, areaBottom + 66 + 28, H - 120);
      }
    }

    // Footer
    ctx.save();
    const footerGrad = ctx.createLinearGradient(0, H - 22, 0, H);
    footerGrad.addColorStop(0, RED_DEEP);
    footerGrad.addColorStop(1, RED);
    ctx.fillStyle = footerGrad;
    ctx.fillRect(0, H - 22, W, 22);
    ctx.restore();
    fitText(ctx, String(m.footer || ""), PAD, H - 52, W - 2 * PAD, S.footer, {
      weight: 600, color: INK,
    });

    // Pet + single highlight stamp (async)
    return new Promise((resolve) => {
      if (!petSvg) {
        resolve(true);
        return;
      }
      const img = new Image();
      img.onload = () => {
        let petRect = null;
        try {
          if (drawToken !== myToken) return resolve(true);
          const iw = img.naturalWidth || 1;
          const ih = img.naturalHeight || 1;
          const scale = Math.min(petBox.w / iw, petBox.h / ih);
          const dw = iw * scale;
          const dh = ih * scale;
          const dx = petBox.x + (petBox.w - dw) / 2;
          const dy = petBox.y + (petBox.h - dh) / 2;
          petRect = { x: dx, y: dy, w: dw, h: dh };
          let src = img;
          if (petTint) {
            // ctx.filter is unreliable here, so tint the pet bitmap directly.
            const temp = document.createElement("canvas");
            temp.width = Math.max(1, Math.round(dw));
            temp.height = Math.max(1, Math.round(dh));
            const tempCtx = temp.getContext("2d");
            tempCtx.imageSmoothingEnabled = true;
            tempCtx.drawImage(img, 0, 0, temp.width, temp.height);
            try { tintSourceCanvas(temp, petTint); } catch {}
            src = temp;
          }
          ctx.save();
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(src, dx, dy, dw, dh);
          ctx.restore();
          if (highlightStamp) {
            drawPetStamp(ctx, src, highlightStamp.cx, highlightStamp.cy, highlightStamp.r, highlightStamp.ring);
          }
        } catch {}
        // The accessory overlays the pet once everything else is placed.
        if (m.petAccessory && petRect) {
          drawPetAccessory(ctx, petRect, m.petAccessory).then(() => resolve(true), () => resolve(true));
        } else {
          resolve(true);
        }
      };
      img.onerror = () => resolve(true);
      img.src = petImageSource(petSvg);
    });
  }

  window.ClawdReportPoster = {
    draw,
    W,
    H,
  };
})();
