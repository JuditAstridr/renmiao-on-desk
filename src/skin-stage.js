"use strict";

// skin-stage.js — shared renderer for skin-mode pets (pet window AND the
// character select preview use this exact module, guaranteeing the preview
// matches the real pet).
//
// Layer order (bottom → top), driven entirely by theme.json + config:
//   1. fill        — solid silhouette in user color (coloring skins only,
//                    derived from the state art by skin-fill.js)
//   2. art         — the state line art / finished bitmap (idle/studying/...)
//   3. patterns    — selected pattern overlays (theme-declared)
//   4. accessories — selected accessories, declared order (scarf/hat/...)
//
// Usage:
//   const stage = createSkinStage(document.getElementById("..."));
//   stage.update({ skin, config, stateKey: "idle", showPlaceholders: false });

(function exposeSkinStage(global) {
  const SKIN_STATES = ["idle", "studying", "reward", "sleeping"];

  function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function createSkinStage(root) {
    if (!root) throw new Error("createSkinStage: root element required");
    root.classList.add("skin-stage-root");
    root.innerHTML = "";

    const stage = el("div", "skin-stage");
    const fill = el("img", "skin-layer skin-fill");
    const art = el("img", "skin-layer skin-art");
    const patternLayer = el("div", "skin-overlay-layer skin-pattern-layer");
    const accessoryLayer = el("div", "skin-overlay-layer skin-accessory-layer");
    const placeholder = el("div", "skin-placeholder");
    placeholder.textContent = "素材待补充";
    placeholder.style.display = "none";

    stage.appendChild(fill);
    stage.appendChild(art);
    stage.appendChild(patternLayer);
    stage.appendChild(accessoryLayer);
    stage.appendChild(placeholder);
    root.appendChild(stage);

    let renderToken = 0;

    function setLayerVisible(node, url) {
      if (url) {
        if (node.getAttribute("src") !== url) node.src = url;
        node.style.display = "";
      } else {
        node.removeAttribute("src");
        node.style.display = "none";
      }
    }

    function syncOverlayLayer(layer, items, selectedIds) {
      const wanted = [];
      if (Array.isArray(selectedIds) && Array.isArray(items)) {
        for (const item of items) {
          if (item && selectedIds.includes(item.id) && item.url) wanted.push(item);
        }
      }
      // Reconcile children by id (cheap: skins have ≤ a few overlays).
      const existing = new Map();
      for (const child of Array.from(layer.children)) {
        existing.set(child.dataset.skinOverlayId, child);
      }
      const keep = new Set();
      for (const item of wanted) {
        keep.add(item.id);
        let img = existing.get(item.id);
        if (!img) {
          img = el("img", "skin-layer skin-overlay");
          img.dataset.skinOverlayId = item.id;
          img.alt = item.name || item.id;
          layer.appendChild(img);
        }
        if (img.getAttribute("src") !== item.url) img.src = item.url;
        img.style.display = "";
      }
      for (const [id, child] of existing) {
        if (!keep.has(id)) child.remove();
      }
    }

    async function render(options) {
      const token = ++renderToken;
      const skin = options && options.skin;
      const config = (options && options.config) || {};
      const requestedState = options && options.stateKey;
      const stateKey = SKIN_STATES.includes(requestedState) ? requestedState : "idle";
      const showPlaceholders = options && options.showPlaceholders === true;

      if (!skin) {
        root.style.display = "none";
        return;
      }
      root.style.display = "block";

      const state = (skin.states && skin.states[stateKey]) || (skin.states && skin.states.idle) || null;
      const artUrl = state && state.url;
      const size = Number(options && options.sizeOverride) || Number(config.size) || 1;
      stage.style.transform = `scale(${Math.min(2, Math.max(0.5, size))})`;

      setLayerVisible(art, artUrl);
      placeholder.style.display = (!artUrl && showPlaceholders) ? "" : "none";

      // Fill layer (coloring skins only). Async — bail if a newer render wins.
      let fillUrl = null;
      if (skin.isColoringSkin && artUrl && config.color && global.SkinFill) {
        fillUrl = await global.SkinFill.getFilledUrl(artUrl, config.color);
      }
      if (token !== renderToken) return;
      setLayerVisible(fill, fillUrl);

      syncOverlayLayer(patternLayer, skin.patterns, config.selectedPatterns);
      syncOverlayLayer(accessoryLayer, skin.accessories, config.selectedAccessories);

      return { skin, stateKey, size, artUrl, fillUrl };
    }

    return { update: render, el: stage };
  }

  global.createSkinStage = createSkinStage;
  global.SKIN_STATES = SKIN_STATES;
})(typeof window !== "undefined" ? window : globalThis);
