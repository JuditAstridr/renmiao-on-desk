"use strict";

// Procedural ambient layers for the pet renderer. Nothing is fetched from the
// network and no theme asset is involved: every layer is generated with Web
// Audio nodes so the feature stays independent from state sound effects.
(function installAmbientSynth(root) {
  const LAYER_NAMES = Object.freeze([
    "white", "pink", "brown", "rain", "fire", "waves", "cafe", "keyboard",
  ]);
  const NOISE_SECONDS = 3;

  function clamp01(value) {
    return typeof value === "number" && Number.isFinite(value)
      ? Math.max(0, Math.min(1, value))
      : 0;
  }

  function createNoiseBuffer(ctx, kind) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_SECONDS));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0; let b4 = 0; let b5 = 0; let b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      if (kind === "white") {
        data[i] = white;
      } else if (kind === "pink") {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329829;
        b5 = -0.76160 * b5 - white * 0.0168980;
        b6 = white * 0.115926;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      } else {
        brown = (brown + 0.02 * white) * 0.98;
        data[i] = brown * 3.5;
      }
    }
    return buffer;
  }

  function createNoiseLayer(ctx, master, buffer) {
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(master);
    let started = false;
    return {
      layerGain: gain,
      start() {
        if (started) return;
        started = true;
        source.start();
      },
      stop() {},
      setVolume(value) { gain.gain.value = clamp01(value); },
      dispose() { try { source.stop(); } catch {} try { gain.disconnect(); } catch {} },
    };
  }

  function createFilteredLayer(ctx, master, buffer, filterType, frequency, pulse) {
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = filterType;
    filter.frequency.value = frequency;
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    let started = false;
    let timer = null;

    function schedulePulse() {
      if (!started) return;
      const delay = pulse.delay();
      timer = setTimeout(() => {
        timer = null;
        schedulePulse();
        if (gain.gain.value > 0.001) pulse.play(ctx, gain);
      }, delay);
    }
    return {
      layerGain: gain,
      start() {
        if (started) return;
        started = true;
        source.start();
        schedulePulse();
      },
      stop() { if (timer) { clearTimeout(timer); timer = null; } },
      setVolume(value) { gain.gain.value = clamp01(value); },
      dispose() {
        if (timer) clearTimeout(timer);
        try { source.stop(); } catch {}
        try { gain.disconnect(); } catch {}
      },
    };
  }

  function createRainPulse(ctx, gain) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const now = ctx.currentTime;
    osc.type = "sine";
    osc.frequency.value = 1500 + Math.random() * 2500;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.08, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(env); env.connect(gain);
    osc.start(now); osc.stop(now + 0.06);
  }

  function createFirePulse(ctx, gain) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.04));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.25));
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();
    source.buffer = buffer;
    filter.type = "bandpass";
    filter.frequency.value = 1200 + Math.random() * 1500;
    filter.Q.value = 1.2;
    env.gain.value = 0.5 + Math.random() * 0.5;
    source.connect(filter); filter.connect(env); env.connect(gain);
    source.start(); source.stop(ctx.currentTime + 0.05);
  }

  function createWavesLayer(ctx, master) {
    const gain = ctx.createGain();
    const swell = createNoiseLayer(ctx, gain, createNoiseBuffer(ctx, "brown"));
    const wash = createNoiseLayer(ctx, gain, createNoiseBuffer(ctx, "white"));
    const foam = createNoiseLayer(ctx, gain, createNoiseBuffer(ctx, "white"));
    const swellFilter = ctx.createBiquadFilter();
    const washFilter = ctx.createBiquadFilter();
    const foamFilter = ctx.createBiquadFilter();
    gain.gain.value = 0;
    gain.connect(master);
    swellFilter.type = "lowpass"; swellFilter.frequency.value = 350;
    washFilter.type = "lowpass"; washFilter.frequency.value = 900;
    foamFilter.type = "highpass"; foamFilter.frequency.value = 3000;
    // Rewire the simple layers through wave-specific filters.
    for (const layer of [swell, wash, foam]) {
      try { layer.layerGain.disconnect(); } catch {}
    }
    swell.layerGain.gain.value = 0.22;
    wash.layerGain.gain.value = 0.10;
    foam.layerGain.gain.value = 0.012;
    swell.layerGain.connect(swellFilter); swellFilter.connect(gain);
    wash.layerGain.connect(washFilter); washFilter.connect(gain);
    foam.layerGain.connect(foamFilter); foamFilter.connect(gain);
    const surf = ctx.createOscillator();
    const foamLfo = ctx.createOscillator();
    const swellDepth = ctx.createGain();
    const washDepth = ctx.createGain();
    const brightness = ctx.createGain();
    const foamDepth = ctx.createGain();
    surf.frequency.value = 0.10; foamLfo.frequency.value = 0.13;
    swellDepth.gain.value = 0.18; washDepth.gain.value = 0.085;
    brightness.gain.value = 900; foamDepth.gain.value = 0.011;
    surf.connect(swellDepth); swellDepth.connect(swell.layerGain.gain);
    surf.connect(washDepth); washDepth.connect(wash.layerGain.gain);
    surf.connect(brightness); brightness.connect(washFilter.frequency);
    foamLfo.connect(foamDepth); foamDepth.connect(foam.layerGain.gain);
    let started = false;
    return {
      layerGain: gain,
      start() {
        if (started) return;
        started = true;
        swell.start(); wash.start(); foam.start(); surf.start(); foamLfo.start();
      },
      stop() {},
      setVolume(value) { gain.gain.value = clamp01(value); },
      dispose() {
        for (const node of [swell, wash, foam]) { try { node.dispose(); } catch {} }
        for (const node of [surf, foamLfo]) { try { node.stop(); } catch {} }
        try { gain.disconnect(); } catch {}
      },
    };
  }

  function createTimedOscillatorLayer(ctx, master, kind) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const oscillators = [];
    let timer = null;
    let started = false;
    if (kind === "cafe") {
      const hum = ctx.createGain();
      hum.gain.value = 0.04;
      hum.connect(gain);
      for (const frequency of [180, 240, 320]) {
        const osc = ctx.createOscillator();
        osc.type = "sine"; osc.frequency.value = frequency;
        osc.connect(hum); oscillators.push(osc);
      }
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 0.15; lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain); lfoGain.connect(hum.gain); oscillators.push(lfo);
    }
    function pulse() {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const now = ctx.currentTime;
      osc.type = kind === "cafe" ? "triangle" : "square";
      osc.frequency.value = kind === "cafe" ? 2500 + Math.random() * 1500 : 2000 + Math.random() * 2000;
      env.gain.setValueAtTime(kind === "cafe" ? 0 : 0.12, now);
      if (kind === "cafe") env.gain.linearRampToValueAtTime(0.06, now + 0.002);
      env.gain.exponentialRampToValueAtTime(0.0001, now + (kind === "cafe" ? 0.08 : 0.06));
      osc.connect(env); env.connect(gain); osc.start(now); osc.stop(now + 0.1);
    }
    function schedule() {
      if (!started) return;
      timer = setTimeout(() => {
        timer = null; schedule();
        if (gain.gain.value > 0.001) pulse();
      }, kind === "cafe" ? 800 + Math.random() * 3000 : 80 + Math.random() * 350);
    }
    return {
      layerGain: gain,
      start() {
        if (started) return;
        started = true;
        for (const osc of oscillators) osc.start();
        schedule();
      },
      stop() { if (timer) { clearTimeout(timer); timer = null; } },
      setVolume(value) { gain.gain.value = clamp01(value); },
      dispose() {
        if (timer) clearTimeout(timer);
        for (const osc of oscillators) { try { osc.stop(); } catch {} }
        try { gain.disconnect(); } catch {}
      },
    };
  }

  function createLayerEngine(ctx, options = {}) {
    const masterGain = ctx.createGain();
    masterGain.gain.value = options.masterVolume == null ? 0.6 : clamp01(options.masterVolume);
    masterGain.connect(ctx.destination);
    const layers = {
      white: createNoiseLayer(ctx, masterGain, createNoiseBuffer(ctx, "white")),
      pink: createNoiseLayer(ctx, masterGain, createNoiseBuffer(ctx, "pink")),
      brown: createNoiseLayer(ctx, masterGain, createNoiseBuffer(ctx, "brown")),
      rain: createFilteredLayer(ctx, masterGain, createNoiseBuffer(ctx, "white"), "highpass", 800, {
        delay: () => 80 + Math.random() * 600, play: createRainPulse,
      }),
      fire: createFilteredLayer(ctx, masterGain, createNoiseBuffer(ctx, "brown"), "lowpass", 700, {
        delay: () => 30 + Math.random() * 250, play: createFirePulse,
      }),
      waves: createWavesLayer(ctx, masterGain),
      cafe: createTimedOscillatorLayer(ctx, masterGain, "cafe"),
      keyboard: createTimedOscillatorLayer(ctx, masterGain, "keyboard"),
    };
    let disposed = false;
    function setParam(gain, value, rampMs) {
      const target = clamp01(value);
      if (!rampMs || rampMs <= 0) { gain.gain.value = target; return; }
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(target, now + rampMs / 1000);
    }
    return {
      masterGain,
      layers,
      LAYER_NAMES,
      setMasterVolume(value, rampMs = 0) { setParam(masterGain, value, rampMs); },
      getMasterVolume() { return masterGain.gain.value; },
      startLayer(name) { if (layers[name]) layers[name].start(); },
      stopLayer(name) { if (layers[name]) layers[name].stop(); },
      setLayerVolume(name, value, rampMs = 0) {
        if (layers[name]) setParam(layers[name].layerGain, value, rampMs);
      },
      applyLayerSet(values, rampMs = 200) {
        for (const name of LAYER_NAMES) {
          const volume = values && typeof values[name] === "number" ? values[name] : 0;
          if (volume > 0) this.startLayer(name);
          this.setLayerVolume(name, volume, rampMs);
        }
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const layer of Object.values(layers)) { try { layer.dispose(); } catch {} }
        try { masterGain.disconnect(); } catch {}
      },
    };
  }

  root.ClawdAmbientSynth = { LAYER_NAMES, createLayerEngine, clamp01 };
})(globalThis);
