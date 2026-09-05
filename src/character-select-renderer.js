"use strict";

// Character select window — renderer logic.
//
// Data flow: character:list-themes → { skins, config, strings } on load;
// every draft change re-renders the preview through the SHARED skin-stage.js
// (identical to the pet window rendering path); character:save persists and
// the main process hot-pushes the new payload to the pet.

(function characterSelectRenderer() {
  const els = {
    title: document.getElementById("cs-title"),
    empty: document.getElementById("cs-empty"),
    previewRoot: document.getElementById("cs-preview-root"),
    stateTabs: document.getElementById("cs-state-tabs"),
    skinCards: document.getElementById("cs-skin-cards"),
    colorPanel: document.getElementById("cs-color-panel"),
    colorLabel: document.getElementById("cs-color-label"),
    colorInput: document.getElementById("cs-color-input"),
    colorPresets: document.getElementById("cs-color-presets"),
    sizeLabel: document.getElementById("cs-size-label"),
    sizeInput: document.getElementById("cs-size-input"),
    sizeValue: document.getElementById("cs-size-value"),
    patternsPanel: document.getElementById("cs-patterns-panel"),
    patternsLabel: document.getElementById("cs-patterns-label"),
    patternsList: document.getElementById("cs-patterns-list"),
    accessoriesPanel: document.getElementById("cs-accessories-panel"),
    accessoriesLabel: document.getElementById("cs-accessories-label"),
    accessoriesList: document.getElementById("cs-accessories-list"),
    confirm: document.getElementById("cs-confirm"),
    cancel: document.getElementById("cs-cancel"),
  };

  const STATE_TAB_KEYS = ["idle", "studying", "reward", "sleeping"];

  const state = {
    strings: {},
    skins: [],
    selectedSkinId: null,
    draft: {
      color: "#ffffff",
      size: 1,
      selectedAccessories: [],
      selectedPatterns: [],
    },
    previewState: "idle",
    saving: false,
  };

  const stage = typeof globalThis.createSkinStage === "function"
    ? globalThis.createSkinStage(els.previewRoot)
    : null;

  function t(key) {
    return state.strings[key] || key;
  }

  function selectedSkin() {
    return state.skins.find((skin) => skin.id === state.selectedSkinId) || null;
  }

  function validIds(items, ids) {
    const allowed = new Set((items || []).map((item) => item.id));
    return (ids || []).filter((id) => allowed.has(id));
  }

  // ── Rendering ──

  function renderPreview() {
    const skin = selectedSkin();
    if (!stage) return;
    if (!skin) {
      els.empty.hidden = false;
      els.previewRoot.style.display = "none";
      return;
    }
    els.empty.hidden = true;
    els.previewRoot.style.display = "";
    stage.update({
      skin,
      config: state.draft,
      stateKey: state.previewState,
      showPlaceholders: true,
    });
  }

  function renderStateTabs() {
    els.stateTabs.innerHTML = "";
    for (const key of STATE_TAB_KEYS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cs-state-tab" + (state.previewState === key ? " active" : "");
      btn.textContent = t(`characterState${key.charAt(0).toUpperCase()}${key.slice(1)}`);
      btn.addEventListener("click", () => {
        state.previewState = key;
        renderStateTabs();
        renderPreview();
      });
      els.stateTabs.appendChild(btn);
    }
  }

  function renderSkinCards() {
    els.skinCards.innerHTML = "";
    for (const skin of state.skins) {
      const card = document.createElement("div");
      card.className = "cs-skin-card" + (skin.id === state.selectedSkinId ? " active" : "");
      card.title = skin.description || skin.name;

      const thumbUrl = skin.states && skin.states.idle && skin.states.idle.url;
      if (thumbUrl) {
        const img = document.createElement("img");
        img.className = "cs-skin-thumb";
        img.src = thumbUrl;
        img.alt = skin.name;
        card.appendChild(img);
      } else {
        const ph = document.createElement("div");
        ph.className = "cs-skin-thumb-placeholder";
        ph.textContent = "…";
        card.appendChild(ph);
      }

      const name = document.createElement("span");
      name.className = "cs-skin-name";
      name.textContent = skin.name;
      card.appendChild(name);

      card.addEventListener("click", () => selectSkin(skin.id));
      els.skinCards.appendChild(card);
    }
  }

  function buildCheckList(container, items, selectedIds, onToggle) {
    container.innerHTML = "";
    if (!items || items.length === 0) {
      const none = document.createElement("div");
      none.className = "cs-check-pending";
      none.textContent = "—";
      container.appendChild(none);
      return;
    }
    for (const item of items) {
      const label = document.createElement("label");
      label.className = "cs-check-item" + (item.missing ? " disabled" : "");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = selectedIds.includes(item.id);
      input.disabled = item.missing;
      input.addEventListener("change", () => {
        onToggle(item.id, input.checked);
      });
      label.appendChild(input);
      const text = document.createElement("span");
      text.textContent = item.name;
      label.appendChild(text);
      if (item.missing) {
        const pending = document.createElement("span");
        pending.className = "cs-check-pending";
        pending.textContent = "素材待补";
        label.appendChild(pending);
      }
      container.appendChild(label);
    }
  }

  function renderPanels() {
    const skin = selectedSkin();
    if (!skin) return;

    // Color panel only for coloring skins.
    els.colorPanel.style.display = skin.isColoringSkin ? "" : "none";
    els.colorInput.value = /^#[0-9a-fA-F]{6}$/.test(state.draft.color) ? state.draft.color : "#ffffff";
    els.colorPresets.innerHTML = "";
    for (const color of skin.presetColors || []) {
      const swatch = document.createElement("button");
      swatch.type = "button";
      swatch.className = "cs-color-swatch" + (state.draft.color.toLowerCase() === color.toLowerCase() ? " active" : "");
      swatch.style.background = color;
      swatch.title = color;
      swatch.addEventListener("click", () => {
        state.draft.color = color;
        els.colorInput.value = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#ffffff";
        renderPanels();
        renderPreview();
      });
      els.colorPresets.appendChild(swatch);
    }

    // Size.
    els.sizeValue.textContent = `${Number(state.draft.size).toFixed(1)}×`;

    // Overlays.
    buildCheckList(
      els.patternsList,
      skin.patterns,
      state.draft.selectedPatterns,
      (id, on) => toggleId(state.draft.selectedPatterns, id, on),
    );
    buildCheckList(
      els.accessoriesList,
      skin.accessories,
      state.draft.selectedAccessories,
      (id, on) => toggleId(state.draft.selectedAccessories, id, on),
    );
  }

  function toggleId(list, id, on) {
    const index = list.indexOf(id);
    if (on && index === -1) list.push(id);
    if (!on && index !== -1) list.splice(index, 1);
    renderPanels();
    renderPreview();
  }

  function selectSkin(skinId) {
    state.selectedSkinId = skinId;
    const skin = selectedSkin();
    if (skin) {
      // Keep saved choices only where they exist on the new skin.
      state.draft.selectedPatterns = validIds(skin.patterns, state.draft.selectedPatterns);
      state.draft.selectedAccessories = validIds(skin.accessories, state.draft.selectedAccessories);
    }
    state.previewState = "idle";
    renderSkinCards();
    renderStateTabs();
    renderPanels();
    renderPreview();
  }

  function applyStrings() {
    const s = state.strings;
    document.title = s.characterSelectTitle || document.title;
    els.title.textContent = s.characterSelectTitle || "";
    els.colorLabel.textContent = s.characterColor || "";
    els.sizeLabel.textContent = s.characterSize || "";
    els.patternsLabel.textContent = s.characterPatterns || "";
    els.accessoriesLabel.textContent = s.characterAccessories || "";
    els.confirm.textContent = s.characterConfirm || "Confirm";
    els.cancel.textContent = s.characterCancel || "Cancel";
    els.empty.textContent = s.characterNoSkins || "";
  }

  // ── Data load ──

  async function init() {
    els.sizeInput.addEventListener("input", () => {
      state.draft.size = Number(els.sizeInput.value);
      els.sizeValue.textContent = `${state.draft.size.toFixed(1)}×`;
      renderPreview();
    });

    els.colorInput.addEventListener("input", () => {
      state.draft.color = els.colorInput.value;
      renderPanels();
      renderPreview();
    });

    els.cancel.addEventListener("click", () => {
      if (window.characterAPI && window.characterAPI.cancel) window.characterAPI.cancel();
      else window.close();
    });

    els.confirm.addEventListener("click", async () => {
      if (state.saving || !selectedSkin()) return;
      state.saving = true;
      els.confirm.disabled = true;
      try {
        if (!window.characterAPI || !window.characterAPI.save) throw new Error("API unavailable");
        const result = await window.characterAPI.save({
          themeId: state.selectedSkinId,
          color: state.draft.color,
          size: state.draft.size,
          selectedAccessories: state.draft.selectedAccessories,
          selectedPatterns: state.draft.selectedPatterns,
          configured: true,
        });
        if (!result || result.ok !== true) {
          throw new Error((result && result.message) || "save failed");
        }
        window.close();
      } catch (err) {
        console.warn("[character-select] save failed:", err && err.message);
        state.saving = false;
        els.confirm.disabled = false;
      }
    });

    if (!window.characterAPI || !window.characterAPI.listThemes) {
      els.empty.hidden = false;
      return;
    }

    const result = await window.characterAPI.listThemes();
    if (!result || result.ok !== true || !result.payload) {
      els.empty.hidden = false;
      els.empty.textContent = (result && result.message) || "load failed";
      return;
    }

    const payload = result.payload;
    state.strings = payload.strings || {};
    state.skins = payload.skins || [];

    if (payload.config) {
      state.draft.color = payload.config.color || "#ffffff";
      state.draft.size = Number(payload.config.size) || 1;
      state.draft.selectedAccessories = Array.isArray(payload.config.selectedAccessories)
        ? [...payload.config.selectedAccessories] : [];
      state.draft.selectedPatterns = Array.isArray(payload.config.selectedPatterns)
        ? [...payload.config.selectedPatterns] : [];
    }
    state.selectedSkinId = (payload.config && payload.config.themeId)
      || (payload.skin && payload.skin.id)
      || (state.skins[0] && state.skins[0].id)
      || null;

    els.sizeInput.value = String(state.draft.size);

    applyStrings();
    if (state.skins.length === 0) {
      els.empty.hidden = false;
      els.confirm.disabled = true;
      return;
    }

    // Full first paint (selectSkin re-renders all sections consistently).
    selectSkin(state.selectedSkinId);
  }

  init();
})();
