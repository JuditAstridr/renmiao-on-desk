"use strict";

// Settings tab for synthesized ambient layers and optional background music.
// All persistence goes through settingsAPI.update, keeping the controller the
// only writer of preferences.
(function initSettingsTabAmbient(root) {
  let state = null;
  let helpers = null;
  let ops = null;

  const LAYER_NAMES = Object.freeze([
    "white", "pink", "brown", "rain", "fire", "waves", "cafe", "keyboard",
  ]);
  const STATES = Object.freeze(["working", "idle", "sleep"]);
  const PRESETS = Object.freeze([
    {
      id: "focus",
      labelKey: "ambientPresetFocus",
      layers: { white: 0, pink: 0, brown: 0.4, rain: 0, fire: 0, waves: 0, cafe: 0.1, keyboard: 0 },
      master: 0.5,
    },
    {
      id: "relax",
      labelKey: "ambientPresetRelax",
      layers: { white: 0, pink: 0, brown: 0.2, rain: 0.4, fire: 0, waves: 0.3, cafe: 0, keyboard: 0 },
      master: 0.6,
    },
    {
      id: "sleep",
      labelKey: "ambientPresetSleep",
      layers: { white: 0, pink: 0, brown: 0.5, rain: 0, fire: 0, waves: 0, cafe: 0, keyboard: 0 },
      master: 0.4,
    },
  ]);

  function t(key) { return helpers.t(key); }

  function snapshotValue(key, fallback) {
    const snapshot = state.snapshot || {};
    return Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : fallback;
  }

  function clamp01(value, fallback = 0) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.max(0, Math.min(1, value));
  }

  function saveBulk(partial) {
    if (!window.settingsAPI || typeof window.settingsAPI.update !== "function") {
      ops.showToast(`${t("toastSaveFailed")}settings API unavailable`, { error: true });
      return;
    }
    const writes = Object.entries(partial).map(([key, value]) =>
      Promise.resolve(window.settingsAPI.update(key, value))
    );
    Promise.all(writes).then((results) => {
      const failed = results.find((result) => !result || result.status !== "ok");
      if (failed) ops.showToast(failed.message || t("toastSaveFailed"), { error: true });
      else ops.showToast(t("ambientSaved"));
      ops.requestRender({ content: true });
    }).catch((error) => {
      ops.showToast(`${t("toastSaveFailed")}${error && error.message ? error.message : ""}`, { error: true });
      ops.requestRender({ content: true });
    });
  }

  function saveOne(key, value) { saveBulk({ [key]: value }); }

  function buildToggle({ labelKey, descKey, checked, disabled, onChange }) {
    const row = document.createElement("div");
    row.className = "row";
    if (disabled) row.classList.add("ambient-row-disabled");

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t(labelKey);
    text.appendChild(label);
    if (descKey) {
      const desc = document.createElement("span");
      desc.className = "row-desc";
      desc.textContent = t(descKey);
      text.appendChild(desc);
    }
    row.appendChild(text);

    const control = document.createElement("div");
    control.className = "row-control";
    const sw = document.createElement("div");
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("tabindex", disabled ? "-1" : "0");
    sw.setAttribute("aria-label", t(labelKey));
    helpers.setSwitchVisual(sw, checked === true);
    if (disabled) {
      sw.classList.add("disabled");
      sw.setAttribute("aria-disabled", "true");
    } else {
      const toggle = () => onChange(!checked);
      sw.addEventListener("click", toggle);
      sw.addEventListener("keydown", (event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          toggle();
        }
      });
    }
    control.appendChild(sw);
    row.appendChild(control);
    return row;
  }

  function buildRangeRow({ labelKey, descKey, value, min, max, step, disabled, onChange }) {
    const row = document.createElement("div");
    row.className = "row ambient-range-row";
    if (disabled) row.classList.add("ambient-row-disabled");

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t(labelKey);
    text.appendChild(label);
    if (descKey) {
      const desc = document.createElement("span");
      desc.className = "row-desc";
      desc.textContent = t(descKey);
      text.appendChild(desc);
    }
    row.appendChild(text);

    const control = document.createElement("div");
    control.className = "row-control ambient-range-control";
    const input = document.createElement("input");
    input.type = "range";
    input.className = "ambient-range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.disabled = disabled === true;
    let commitTimer = null;
    const commit = () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = null;
      onChange(Number(input.value));
    };
    input.addEventListener("input", () => {
      if (commitTimer) clearTimeout(commitTimer);
      commitTimer = setTimeout(commit, 200);
    });
    input.addEventListener("change", commit);
    control.appendChild(input);
    row.appendChild(control);
    return row;
  }

  function buildLayersSection() {
    const enabled = snapshotValue("ambientEnabled", false) === true;
    const layers = snapshotValue("ambientLayers", {}) || {};
    const rows = LAYER_NAMES.map((name) => buildRangeRow({
      labelKey: `ambientLayer_${name}`,
      value: clamp01(layers[name]),
      min: 0,
      max: 1,
      step: 0.01,
      disabled: !enabled,
      onChange: (value) => saveOne("ambientLayers", { ...layers, [name]: value }),
    }));
    rows.push(buildRangeRow({
      labelKey: "ambientMaster",
      descKey: "ambientMasterDesc",
      value: clamp01(snapshotValue("ambientMasterVolume", 0.6), 0.6),
      min: 0,
      max: 1,
      step: 0.01,
      disabled: !enabled,
      onChange: (value) => saveOne("ambientMasterVolume", value),
    }));
    return helpers.buildSection(t("ambientLayersSection"), rows);
  }

  function buildPresetsSection() {
    const enabled = snapshotValue("ambientEnabled", false) === true;
    const row = document.createElement("div");
    row.className = "row ambient-presets-row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("ambientPresets");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("ambientPresetsDesc");
    text.append(label, desc);
    row.appendChild(text);

    const control = document.createElement("div");
    control.className = "row-control ambient-presets";
    for (const preset of PRESETS) {
      const button = helpers.buildButton({ labelKey: preset.labelKey, tone: "neutral", size: "compact" });
      if (!enabled) {
        button.disabled = true;
      } else {
        button.addEventListener("click", () => saveBulk({
          ambientLayers: { ...preset.layers },
          ambientMasterVolume: preset.master,
        }));
      }
      control.appendChild(button);
    }
    row.appendChild(control);
    return helpers.buildSection(t("ambientPresetsSection"), [row]);
  }

  function buildStateBindingSection() {
    const enabled = snapshotValue("ambientEnabled", false) === true;
    const auto = snapshotValue("ambientAutoStateBinding", false) === true;
    const binding = snapshotValue("ambientStateBinding", {}) || {};
    const rows = [buildToggle({
      labelKey: "ambientAutoStateBinding",
      descKey: "ambientAutoStateBindingDesc",
      checked: auto,
      disabled: !enabled,
      onChange: (value) => saveOne("ambientAutoStateBinding", value),
    })];

    for (const stateName of STATES) {
      const selected = Array.isArray(binding[stateName]) ? binding[stateName] : [];
      const row = document.createElement("div");
      row.className = "row ambient-state-binding-row";
      const label = document.createElement("span");
      label.className = "row-label";
      label.textContent = t(`ambientState_${stateName}`);
      row.appendChild(label);
      const control = document.createElement("div");
      control.className = "row-control ambient-layer-checkboxes";
      for (const layerName of LAYER_NAMES) {
        const wrapper = document.createElement("label");
        wrapper.className = "ambient-layer-checkbox";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.includes(layerName);
        checkbox.disabled = !enabled || !auto;
        checkbox.addEventListener("change", () => {
          const next = new Set(selected);
          if (checkbox.checked) next.add(layerName);
          else next.delete(layerName);
          saveOne("ambientStateBinding", { ...binding, [stateName]: [...next] });
        });
        const name = document.createElement("span");
        name.textContent = t(`ambientLayer_${layerName}`);
        wrapper.append(checkbox, name);
        control.appendChild(wrapper);
      }
      row.appendChild(control);
      rows.push(row);
    }

    return helpers.buildCollapsibleGroup({
      id: "ambient.state-binding",
      title: t("ambientStateBindingSection"),
      desc: t("ambientStateBindingSectionDesc"),
      defaultCollapsed: true,
      className: "ambient-state-binding-card",
      children: rows,
    });
  }

  function buildMusicSection() {
    const enabled = snapshotValue("ambientEnabled", false) === true;
    const musicEnabled = snapshotValue("ambientMusicEnabled", false) === true;
    const source = String(snapshotValue("ambientMusicSource", "") || "");
    const volume = clamp01(snapshotValue("ambientMusicVolume", 0.5), 0.5);
    const rows = [buildToggle({
      labelKey: "ambientMusicEnabled",
      descKey: "ambientMusicEnabledDesc",
      checked: musicEnabled,
      disabled: !enabled,
      onChange: (value) => saveOne("ambientMusicEnabled", value),
    })];

    const sourceRow = document.createElement("div");
    sourceRow.className = "row ambient-music-source-row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("ambientMusicSource");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("ambientMusicSourceDesc");
    text.append(label, desc);
    sourceRow.appendChild(text);
    const control = document.createElement("div");
    control.className = "row-control ambient-music-source-control";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ambient-music-source-input";
    input.value = source;
    input.placeholder = "https://…/stream.mp3";
    input.maxLength = 4096;
    input.disabled = !enabled || !musicEnabled;
    const saveSource = () => {
      saveOne("ambientMusicSource", input.value.trim());
    };
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveSource();
        input.blur();
      }
    });
    input.addEventListener("change", saveSource);
    control.appendChild(input);
    if (window.settingsAPI && typeof window.settingsAPI.pickAmbientMusicSource === "function") {
      const browse = helpers.buildButton({ labelKey: "ambientMusicBrowse", size: "compact" });
      browse.disabled = !enabled || !musicEnabled;
      browse.addEventListener("click", () => {
        Promise.resolve(window.settingsAPI.pickAmbientMusicSource()).then((picked) => {
          const path = picked && typeof picked.path === "string" ? picked.path : "";
          if (path) {
            input.value = path;
            saveOne("ambientMusicSource", path);
          }
        }).catch((error) => ops.showToast(
          `${t("toastSaveFailed")}${error && error.message ? error.message : ""}`,
          { error: true }
        ));
      });
      control.appendChild(browse);
    }
    sourceRow.appendChild(control);
    rows.push(sourceRow);
    rows.push(buildRangeRow({
      labelKey: "ambientMusicVolume",
      value: volume,
      min: 0,
      max: 1,
      step: 0.01,
      disabled: !enabled || !musicEnabled,
      onChange: (value) => saveOne("ambientMusicVolume", value),
    }));
    return helpers.buildCollapsibleGroup({
      id: "ambient.music",
      title: t("ambientMusicSection"),
      desc: t("ambientMusicSectionDesc"),
      defaultCollapsed: true,
      className: "ambient-music-card",
      children: rows,
    });
  }

  function buildAdvancedSection() {
    const enabled = snapshotValue("ambientEnabled", false) === true;
    return helpers.buildCollapsibleGroup({
      id: "ambient.advanced",
      title: t("ambientAdvancedSection"),
      desc: t("ambientAdvancedSectionDesc"),
      defaultCollapsed: true,
      className: "ambient-advanced-card",
      children: [
        buildRangeRow({
          labelKey: "ambientDuckingMs",
          descKey: "ambientDuckingMsDesc",
          value: Number(snapshotValue("ambientDuckingMs", 500)) || 500,
          min: 100,
          max: 3000,
          step: 100,
          disabled: !enabled,
          onChange: (value) => saveOne("ambientDuckingMs", Math.round(value)),
        }),
        buildRangeRow({
          labelKey: "ambientDuckCooldownMs",
          descKey: "ambientDuckCooldownMsDesc",
          value: Number(snapshotValue("ambientDuckCooldownMs", 2000)) || 2000,
          min: 500,
          max: 10000,
          step: 100,
          disabled: !enabled,
          onChange: (value) => saveOne("ambientDuckCooldownMs", Math.round(value)),
        }),
      ],
    });
  }

  function buildResetSection() {
    const enabled = snapshotValue("ambientEnabled", false) === true;
    const button = helpers.buildButton({ labelKey: "ambientResetButton", size: "compact" });
    button.disabled = !enabled;
    button.addEventListener("click", () => saveBulk({
      ambientLayers: { white: 0, pink: 0, brown: 0.3, rain: 0.5, fire: 0, waves: 0, cafe: 0, keyboard: 0 },
      ambientMasterVolume: 0.6,
      ambientAutoStateBinding: false,
      ambientStateBinding: { working: ["brown", "rain"], idle: ["white"], sleep: ["brown"] },
      ambientMusicEnabled: false,
      ambientMusicSource: "",
      ambientMusicVolume: 0.5,
      ambientDuckingMs: 500,
      ambientDuckCooldownMs: 2000,
    }));
    const row = document.createElement("div");
    row.className = "row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("ambientReset");
    text.appendChild(label);
    row.append(text);
    const control = document.createElement("div");
    control.className = "row-control";
    control.appendChild(button);
    row.appendChild(control);
    return helpers.buildSection(t("ambientResetSection"), [row]);
  }

  function render(parent) {
    const title = document.createElement("h1");
    title.textContent = t("ambientTitle");
    parent.appendChild(title);
    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("ambientSubtitle");
    parent.appendChild(subtitle);
    parent.appendChild(helpers.buildSection(t("ambientPowerSection"), [buildToggle({
      labelKey: "ambientEnabled",
      descKey: "ambientEnabledDesc",
      checked: snapshotValue("ambientEnabled", false) === true,
      disabled: false,
      onChange: (value) => saveOne("ambientEnabled", value),
    })]));
    parent.appendChild(buildLayersSection());
    parent.appendChild(buildPresetsSection());
    parent.appendChild(buildStateBindingSection());
    parent.appendChild(buildMusicSection());
    parent.appendChild(buildAdvancedSection());
    parent.appendChild(buildResetSection());
  }

  function init(settingsCore) {
    state = settingsCore.state;
    helpers = settingsCore.helpers;
    ops = settingsCore.ops;
    settingsCore.tabs.ambient = { render };
  }

  root.ClawdSettingsTabAmbient = { init };
})(globalThis);
