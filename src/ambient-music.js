"use strict";

// Optional background music branch. It intentionally does not connect to the
// ambient Web Audio bus, which keeps cross-origin streams playable.
(function installAmbientMusic(root) {
  function clamp01(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  }

  function encodeFilePath(value) {
    return value.split("/").map((part, index) => index === 0 ? part : encodeURIComponent(part)).join("/");
  }

  function isAbsoluteLocalPath(value) {
    const normalized = String(value || "").replace(/\\/g, "/");
    return normalized.startsWith("/")
      || /^[A-Za-z]:\//.test(normalized)
      || /^\/\/[^/]+\/[^/]+/.test(normalized);
  }

  function isAllowedSource(value) {
    if (typeof value !== "string") return false;
    const source = value.trim();
    if (!source) return true;
    if (isAbsoluteLocalPath(source)) return true;
    try {
      const parsed = new URL(source);
      if (/^https:\/\//i.test(source) && parsed.protocol === "https:" && parsed.hostname) return true;
      // Only local file URLs are accepted. A UNC path is handled above; a
      // file URL with a remote host would make the setting an unexpected
      // second network transport.
      return /^file:\/\//i.test(source)
        && parsed.protocol === "file:"
        && (!parsed.hostname || parsed.hostname.toLowerCase() === "localhost");
    } catch {
      return false;
    }
  }

  function toMediaSource(value) {
    const source = String(value || "").trim();
    if (!source) return "";
    if (!isAllowedSource(source)) return "";
    if (/^(?:https:|file:)/i.test(source)) return source;
    const normalized = source.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) return `file:///${encodeFilePath(normalized)}`;
    if (normalized.startsWith("//")) return `file://${encodeFilePath(normalized.slice(2))}`;
    if (normalized.startsWith("/")) return `file://${encodeFilePath(normalized)}`;
    return "";
  }

  function createMusicController() {
    let audio = null;
    let source = "";
    let targetVolume = 0.5;
    let rampTimer = null;
    let endedCallback = null;
    let disposed = false;

    function clearRamp() {
      if (rampTimer) { clearInterval(rampTimer); rampTimer = null; }
    }

    function setImmediate(value) {
      if (audio) {
        try { audio.volume = clamp01(value); } catch {}
      }
    }

    function rampTo(value, duration) {
      targetVolume = clamp01(value);
      clearRamp();
      if (!audio || duration <= 0) { setImmediate(targetVolume); return; }
      const from = clamp01(audio.volume || 0);
      const steps = Math.max(1, Math.ceil(duration / 16));
      let step = 0;
      rampTimer = setInterval(() => {
        step += 1;
        const current = step >= steps ? targetVolume : from + (targetVolume - from) * (step / steps);
        setImmediate(current);
        if (step >= steps) clearRamp();
      }, 16);
    }

    function ensureAudio() {
      if (audio) return audio;
      audio = new Audio();
      audio.preload = "auto";
      audio.loop = true;
      audio.addEventListener("ended", () => {
        if (typeof endedCallback === "function") {
          try { endedCallback(); } catch {}
        }
      });
      audio.addEventListener("error", (event) => {
        try { console.warn("Renmi ambient music error", audio.error && audio.error.code, event); } catch {}
      });
      return audio;
    }

    function load(value) {
      const next = String(value || "").trim();
      if (!next) { stop(); source = ""; return false; }
      if (!isAllowedSource(next)) {
        stop();
        source = "";
        return false;
      }
      const element = ensureAudio();
      try { element.pause(); } catch {}
      const mediaSource = toMediaSource(next);
      if (!mediaSource) return false;
      try { element.removeAttribute("src"); element.src = mediaSource; element.load(); }
      catch (error) {
        try { console.warn("Renmi ambient music load failed", error && error.message); } catch {}
        return false;
      }
      source = next;
      setImmediate(targetVolume);
      return true;
    }

    function play() {
      if (disposed || !audio || !source) return false;
      try {
        const promise = audio.play();
        if (promise && typeof promise.catch === "function") {
          promise.catch((error) => {
            try { console.warn("Renmi ambient music play rejected", error && error.message); } catch {}
          });
        }
        return true;
      } catch (error) {
        try { console.warn("Renmi ambient music play failed", error && error.message); } catch {}
        return false;
      }
    }

    function pause() { if (audio) { try { audio.pause(); } catch {} } }

    function stop() {
      clearRamp();
      if (!audio) return;
      try { audio.pause(); } catch {}
      try { audio.currentTime = 0; } catch {}
    }

    function setVolume(value, duration = 0) {
      targetVolume = clamp01(value);
      if (duration > 0) rampTo(targetVolume, duration);
      else { clearRamp(); setImmediate(targetVolume); }
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      clearRamp(); endedCallback = null;
      if (audio) {
        try { audio.pause(); } catch {}
        try { audio.removeAttribute("src"); audio.load(); } catch {}
      }
      audio = null; source = "";
    }

    return {
      load, play, pause, stop, setVolume,
      getTargetVolume: () => targetVolume,
      getSource: () => source,
      getElement: () => audio,
      onEnded: (callback) => { endedCallback = typeof callback === "function" ? callback : null; },
      dispose,
    };
  }

  root.ClawdAmbientMusic = { createMusicController, clamp01, isAllowedSource, toMediaSource };
})(globalThis);
