"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadSynth() {
  const context = {
    globalThis: null,
    Math,
    // Do not execute the recurring pulse timers in this unit test. The layer
    // startup and gain routing are what this test needs to observe.
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "src", "ambient-synth.js"), "utf8"),
    context
  );
  return context.ClawdAmbientSynth;
}

class FakeAudioParam {
  constructor(value = 0) {
    this.value = value;
  }

  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.nodes = [];
    this.destination = this.createNode("destination");
  }

  createNode(kind) {
    const node = {
      kind,
      startCount: 0,
      stopCount: 0,
      gain: new FakeAudioParam(0),
      frequency: new FakeAudioParam(0),
      Q: new FakeAudioParam(0),
      type: "",
      buffer: null,
      loop: false,
      connect() {},
      disconnect() {},
      start() { this.startCount += 1; },
      stop() { this.stopCount += 1; },
    };
    this.nodes.push(node);
    return node;
  }

  createBuffer(_channels, length) {
    return { getChannelData: () => new Float32Array(length) };
  }

  createBufferSource() { return this.createNode("buffer-source"); }
  createGain() { return this.createNode("gain"); }
  createBiquadFilter() { return this.createNode("biquad-filter"); }
  createOscillator() { return this.createNode("oscillator"); }
}

describe("ambient procedural sound engine", () => {
  it("starts and routes every selectable layer when its volume is positive", () => {
    const Synth = loadSynth();
    const ctx = new FakeAudioContext();
    const engine = Synth.createLayerEngine(ctx, { masterVolume: 1 });
    const values = Object.fromEntries(Synth.LAYER_NAMES.map((name) => [name, 0.5]));

    engine.applyLayerSet(values, 0);

    for (const name of Synth.LAYER_NAMES) {
      assert.equal(engine.layers[name].layerGain.gain.value, 0.5, name);
    }

    // Five direct/filtered layers plus three wave sources, and two wave LFOs
    // plus four cafe oscillators, prove that the non-white branches also start.
    const startedBuffers = ctx.nodes.filter((node) => (
      node.kind === "buffer-source" && node.startCount > 0
    ));
    const startedOscillators = ctx.nodes.filter((node) => (
      node.kind === "oscillator" && node.startCount > 0
    ));
    assert.equal(startedBuffers.length, 8);
    assert.equal(startedOscillators.length, 6);
  });
});
