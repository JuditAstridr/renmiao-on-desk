"use strict";

// skin-fill.js — shared renderer helper (pet window + character select page).
//
// Coloring skins are line-art PNGs with transparent interiors (e.g. the cat).
// To "fill the body" with the user's color we derive a solid silhouette at
// runtime: draw the art to an offscreen canvas, treat dark/stroked pixels as
// walls, dilate the walls by 1px to close anti-aliased gaps, flood-fill from
// the image borders to find the exterior, then paint every enclosed
// (interior) cell with the chosen color. The original line art is layered on
// top by skin-stage.js, so the result reads as "colored body + dark outline".
//
// Result data URLs are cached by (artUrl, color) — each state/color pair is
// computed once. If the canvas ever becomes tainted/unavailable the helpers
// resolve to null and callers simply skip the fill layer.

(function exposeSkinFill(global) {
  const cache = new Map();

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load image: ${url}`));
      img.src = url;
    });
  }

  function hexToRgb(hex) {
    let value = String(hex || "").trim();
    if (value[0] === "#") value = value.slice(1);
    if (value.length === 3) {
      value = value.split("").map((c) => c + c).join("");
    }
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
      return { r: 255, g: 255, b: 255 };
    }
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  async function buildFilledDataUrl(artUrl, color) {
    const img = await loadImage(artUrl);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch (err) {
      console.warn("[skin-fill] canvas unavailable:", err && err.message);
      return null;
    }

    const { data } = imageData;
    const total = w * h;
    const WALL_ALPHA = 40;

    // Wall = any cell the artist drew on. Dilate by 1px (4-neighbourhood) so
    // anti-aliased seams in the outline can't leak the flood fill.
    const wall = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      if (data[i * 4 + 3] > WALL_ALPHA) wall[i] = 1;
    }
    const dilated = new Uint8Array(total);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (!wall[i]) continue;
        dilated[i] = 1;
        if (x > 0) dilated[i - 1] = 1;
        if (x < w - 1) dilated[i + 1] = 1;
        if (y > 0) dilated[i - w] = 1;
        if (y < h - 1) dilated[i + w] = 1;
      }
    }

    // Flood fill from every border cell to mark the exterior.
    const exterior = new Uint8Array(total);
    const stack = [];
    for (let x = 0; x < w; x += 1) {
      stack.push(x, (h - 1) * w + x);
    }
    for (let y = 0; y < h; y += 1) {
      stack.push(y * w, y * w + (w - 1));
    }
    while (stack.length > 0) {
      const i = stack.pop();
      if (exterior[i] || dilated[i]) continue;
      exterior[i] = 1;
      const x = i % w;
      const y = (i - x) / w;
      if (x > 0) stack.push(i - 1);
      if (x < w - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - w);
      if (y < h - 1) stack.push(i + w);
    }

    // Interior = enclosed, non-wall cells → paint with the chosen color.
    const rgb = hexToRgb(color);
    for (let i = 0; i < total; i += 1) {
      if (dilated[i] || exterior[i]) continue;
      const offset = i * 4;
      data[offset] = rgb.r;
      data[offset + 1] = rgb.g;
      data[offset + 2] = rgb.b;
      data[offset + 3] = 255;
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function getFilledUrl(artUrl, color) {
    if (!artUrl) return null;
    const key = `${artUrl}|${String(color || "").toLowerCase()}`;
    if (cache.has(key)) return cache.get(key);
    const promise = buildFilledDataUrl(artUrl, color).catch((err) => {
      console.warn("[skin-fill] fill failed:", err && err.message);
      return null;
    });
    cache.set(key, promise);
    return promise;
  }

  global.SkinFill = { getFilledUrl, hexToRgb };
})(typeof window !== "undefined" ? window : globalThis);
