"use strict";

// Main-process poster resource resolver.  The Study renderer never reads from
// the filesystem directly: SVG frames, optional accessories, and the poster
// kit are converted to data URLs here so the same IPC contract works in dev,
// packaged asar, and for user-installed themes.

const defaultFs = require("fs");
const defaultPath = require("path");

const POSTER_FRAME_ROLES = Object.freeze({
  idle: ["idle"],
  happy: ["attention", "happy", "yawning"],
  tired: ["yawning", "dozing", "sleeping"],
  thinking: ["thinking", "working", "juggling"],
});

const POSTER_KIT_MANIFEST = Object.freeze({
  "icon-focus": "素材/03_图标/01_闹钟.png",
  "icon-time": "素材/03_图标/06_时钟.png",
  "icon-tasks": "素材/03_图标/07_对勾.png",
  "icon-points": "素材/03_图标/09_奖杯.png",
  "deco-tomato": "素材/02_贴图元素/01_完整番茄.png",
  "deco-tomato-slice": "素材/02_贴图元素/02_番茄横切.png",
  "deco-wedge": "素材/02_贴图元素/04_番茄角.png",
  "deco-chip": "素材/02_贴图元素/03_番茄切片.png",
});

function createStudyPosterAssets(options = {}) {
  const fs = options.fs || defaultFs;
  const path = options.path || defaultPath;
  const themeLoader = options.themeLoader;
  const getActiveTheme = typeof options.getActiveTheme === "function"
    ? options.getActiveTheme : () => null;
  const getSettingsSnapshot = typeof options.getSettingsSnapshot === "function"
    ? options.getSettingsSnapshot : () => ({});
  const nativeImage = options.nativeImage || null;
  const getPetTintIdForTheme = options.getPetTintIdForTheme || (() => "none");
  const resolvePetTintPayload = options.resolvePetTintPayload || (() => ({ filter: "" }));
  const getEffectivePetAccessoryIdForTheme = options.getEffectivePetAccessoryIdForTheme || (() => "none");
  const buildPetAccessoryPayload = options.buildPetAccessoryPayload || (() => ({ id: "none" }));
  const rootDir = options.rootDir || path.resolve(__dirname, "..");
  const posterAssetsDir = options.posterAssetsDir || path.join(rootDir, "assets", "poster");
  const posterFontPath = options.posterFontPath || path.join(rootDir, "assets", "fonts", "也字工厂小石头.woff2");
  const globalSvgDir = options.globalSvgDir || path.join(rootDir, "assets", "svg");
  const globalAccessoriesDir = options.globalAccessoriesDir || path.join(rootDir, "assets", "accessories");

  function exists(file) {
    try { return typeof file === "string" && fs.existsSync(file); } catch { return false; }
  }

  function themeAssetPath(theme, file, extraDir = null) {
    if (!theme || typeof file !== "string" || !file) return null;
    const base = path.basename(file);
    const candidates = [];
    if (theme._builtin && theme._themeDir) {
      candidates.push(path.join(theme._themeDir, "assets", base));
    } else {
      if (theme._assetsDir) candidates.push(path.join(theme._assetsDir, base));
      if (theme._themeDir) candidates.push(path.join(theme._themeDir, "assets", base));
    }
    if (extraDir) candidates.push(path.join(extraDir, base));
    candidates.push(path.join(globalSvgDir, base));
    return candidates.find(exists) || null;
  }

  function rasterDataUrl(abs) {
    try {
      if (nativeImage && typeof nativeImage.createFromPath === "function") {
        const image = nativeImage.createFromPath(abs);
        if (image && !image.isEmpty()) return image.toDataURL();
      }
      const data = fs.readFileSync(abs).toString("base64");
      const mime = /\.apng$/i.test(abs) ? "image/apng" : "image/png";
      return `data:${mime};base64,${data}`;
    } catch {
      return null;
    }
  }

  // Renmi's SVG frames reference the companion PNG with a relative href.
  // Once the SVG is moved into a data URL, that href no longer resolves
  // against the theme directory. Inline local image references so the poster
  // remains self-contained in dev, packaged, and external-theme builds.
  function inlineSvgImages(svg, baseDir) {
    if (typeof svg !== "string" || !baseDir) return svg;
    return svg.replace(/(\b(?:href|xlink:href)\s*=\s*)(["'])([^"']+)\2/gi,
      (match, prefix, quote, rawRef) => {
        const ref = String(rawRef || "").trim();
        if (!ref || /^(?:data:|https?:|file:|#)/i.test(ref)) return match;
        let decoded = ref;
        try { decoded = decodeURIComponent(ref); } catch {}
        const abs = path.resolve(baseDir, decoded.split("#", 1)[0]);
        const relative = path.relative(baseDir, abs);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !exists(abs)) {
          return match;
        }
        const dataUrl = rasterDataUrl(abs);
        return dataUrl ? `${prefix}${quote}${dataUrl}${quote}` : match;
      });
  }

  function frameFor(theme, stateName) {
    const states = theme && theme.states && typeof theme.states === "object" ? theme.states : {};
    const files = Array.isArray(states[stateName]) ? states[stateName] : [];
    for (const file of files) {
      if (typeof file !== "string" || !file) continue;
      const abs = themeAssetPath(theme, file);
      if (!abs) continue;
      if (/\.svg$/i.test(file)) return { abs, kind: "svg" };
      if (/\.(png|apng)$/i.test(file)) return { abs, kind: "raster" };
    }
    return null;
  }

  function fileDataUrl(frame) {
    try {
      if (frame.kind === "svg") {
        const svg = inlineSvgImages(fs.readFileSync(frame.abs, "utf8"), path.dirname(frame.abs));
        return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      }
      return rasterDataUrl(frame.abs);
    } catch {
      return null;
    }
  }

  function buildThemeFrames(theme) {
    if (!theme) return null;
    const frames = {};
    for (const [role, states] of Object.entries(POSTER_FRAME_ROLES)) {
      for (const stateName of states) {
        const frame = frameFor(theme, stateName);
        const dataUrl = frame && fileDataUrl(frame);
        if (dataUrl) {
          frames[role] = dataUrl;
          break;
        }
      }
    }
    return frames.idle ? frames : null;
  }

  function activeTint(theme) {
    if (!theme) return "";
    try {
      const settings = getSettingsSnapshot() || {};
      const tintId = getPetTintIdForTheme(settings.petTint, theme._id);
      const payload = resolvePetTintPayload(tintId, theme);
      return payload && typeof payload.filter === "string" ? payload.filter : "";
    } catch {
      return "";
    }
  }

  function activeAccessory(theme) {
    if (!theme) return null;
    try {
      const settings = getSettingsSnapshot() || {};
      const accessoryId = getEffectivePetAccessoryIdForTheme({
        petAccessory: settings.petAccessory,
        holidayAccessoryEnabled: settings.holidayAccessoryEnabled,
        themeId: theme._id,
        pointsTotal: Number.isFinite(Number(options.getStudyPoints && options.getStudyPoints()))
          ? Number(options.getStudyPoints()) : null,
      });
      const payload = buildPetAccessoryPayload(accessoryId, theme, {
        pointsTotal: Number.isFinite(Number(options.getStudyPoints && options.getStudyPoints()))
          ? Number(options.getStudyPoints()) : null,
      });
      if (!payload || payload.id === "none" || !payload.assetFile) return null;
      const abs = themeAssetPath(theme, payload.assetFile, globalAccessoriesDir);
      if (!abs) return null;
      const svg = fs.readFileSync(abs, "utf8");
      return {
        svg: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
        aspect: payload.aspect,
        widthScale: payload.widthScale,
        offsetY: payload.offsetY,
      };
    } catch {
      return null;
    }
  }

  function getActivePet() {
    let theme = null;
    try {
      theme = getActiveTheme();
      if (!theme && themeLoader && typeof themeLoader.loadTheme === "function") {
        theme = themeLoader.loadTheme("renmi", { strict: false });
      }
    } catch {
      theme = null;
    }
    const frames = buildThemeFrames(theme);
    if (!frames) return null;
    return {
      id: theme._id || "renmi",
      name: theme.name || theme._id || "Renmiao",
      active: true,
      frames,
      tint: activeTint(theme),
      accessory: activeAccessory(theme),
    };
  }

  function getPosterAssets(ids) {
    const output = {};
    const requested = Array.isArray(ids) ? ids.slice(0, 32) : [];
    for (const rawId of requested) {
      const id = String(rawId);
      const relative = POSTER_KIT_MANIFEST[id];
      if (!relative) continue;
      try {
        const abs = path.join(posterAssetsDir, relative);
        if (exists(abs)) output[id] = `data:image/png;base64,${fs.readFileSync(abs).toString("base64")}`;
      } catch {}
    }
    return output;
  }

  function getPosterFont() {
    try {
      if (!exists(posterFontPath)) return null;
      return { base64: fs.readFileSync(posterFontPath).toString("base64") };
    } catch {
      return null;
    }
  }

  return { getActivePet, getPosterAssets, getPosterFont };
}

module.exports = { createStudyPosterAssets, POSTER_FRAME_ROLES, POSTER_KIT_MANIFEST };
