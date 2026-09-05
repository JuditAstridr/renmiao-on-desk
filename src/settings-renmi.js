"use strict";

(function initRenmiSettings() {
  const api = window.settingsAPI;
  const sidebar = document.getElementById("sidebar");
  const content = document.getElementById("content");
  let snapshot = null;
  let activeTab = "general";
  let themes = [];
  let themeLoading = false;

  const TEXT = {
    en: {
      generalTitle: "General", generalDesc: "Make Renmi fit your desk and your study rhythm.", language: "Language", size: "Pet size", showTray: "Show menu bar / tray icon", showDock: "Show Dock icon", openAtLogin: "Open Renmi at login", freeRoam: "Let Renmi roam when idle", edgePin: "Allow edge pinning", mini: "Enable mini mode", lowPower: "Use low-power idle mode", soundMuted: "Mute pet sounds", soundVolume: "Pet sound volume", study: "Open Study Dashboard", studyFollowPet: "Keep Study panel near Renmi", hide: "Hide Renmi", saved: "Saved", failed: "Could not save: ",
      themeTitle: "Theme", themeDesc: "Choose Renmi's appearance and customize its colors.", active: "Active", customize: "Customize", tint: "Pet color", tintNone: "Original", tintCream: "Cream", tintGray: "Light gray", tintBrown: "Light brown", saturation: "Color saturation",
      ambientTitle: "Ambient Sound", ambientDesc: "Layered white noise and nature sounds for focus or relaxation.", enabled: "Enable ambient sound", master: "Master volume", stateBinding: "Follow pet activity", layer: "Layer volume", reset: "Reset ambient sound",
      animationTitle: "Animation & Sound", animationDesc: "Choose the resting animation and tune feedback sounds.", idleVisual: "Resting animation", defaultVisual: "Theme default", mute: "Mute completion sounds", volume: "Completion sound volume",
      shortcutTitle: "Shortcuts", shortcutDesc: "Only Renmi controls are available here.", togglePet: "Show / hide Renmi", shortcutPlaceholder: "CommandOrControl+Shift+Alt+C", apply: "Apply", resetShortcut: "Reset",
      aboutTitle: "About Renmi", aboutDesc: "A small study companion for your desktop.", account: "Account", signIn: "Sign in / register", signOut: "Sign out", updates: "Check for updates", version: "Version", noAccount: "Not signed in", updateRequested: "Update check started.",
      layers: { white: "White noise", pink: "Pink noise", brown: "Brown noise", rain: "Rain", fire: "Fire", waves: "Waves", cafe: "Cafe", keyboard: "Keyboard" },
      states: { idle: "Idle", working: "Focus", sleep: "Sleep" },
    },
    zh: {
      general: "常规", theme: "主题", ambient: "环境音", animation: "动画与声音", shortcuts: "快捷键", about: "关于",
      generalTitle: "常规", generalDesc: "调整 Renmi 的桌面行为和学习节奏。", language: "语言", size: "桌宠大小", showTray: "显示菜单栏 / 托盘图标", showDock: "显示 Dock 图标", openAtLogin: "登录时启动 Renmi", freeRoam: "空闲时让 Renmi 自由漫游", edgePin: "允许贴边隐藏", mini: "启用迷你模式", lowPower: "使用低功耗空闲模式", soundMuted: "静音桌宠声音", soundVolume: "桌宠声音音量", study: "打开学习面板", studyFollowPet: "学习面板跟随桌宠位置", hide: "隐藏 Renmi", saved: "已保存", failed: "保存失败：",
      themeTitle: "主题", themeDesc: "选择 Renmi 的外观并自定义颜色。", active: "当前", customize: "自定义", tint: "桌宠颜色", tintNone: "原色", tintCream: "奶油色", tintGray: "浅灰色", tintBrown: "浅棕色", saturation: "颜色饱和度",
      ambientTitle: "环境音", ambientDesc: "用于专注或放松的白噪音和自然声音图层。", enabled: "启用环境音", master: "总音量", stateBinding: "跟随桌宠状态", layer: "图层音量", reset: "重置环境音",
      animationTitle: "动画与声音", animationDesc: "选择休息动画并调整反馈声音。", idleVisual: "休息动画", defaultVisual: "主题默认", mute: "静音完成提示音", volume: "完成提示音音量",
      shortcutTitle: "快捷键", shortcutDesc: "这里只保留 Renmi 自身的控制。", togglePet: "显示 / 隐藏 Renmi", shortcutPlaceholder: "CommandOrControl+Shift+Alt+C", apply: "应用", resetShortcut: "重置",
      aboutTitle: "关于 Renmi", aboutDesc: "一个陪伴学习的桌面小伙伴。", account: "账户", signIn: "登录 / 注册", signOut: "退出登录", updates: "检查更新", version: "版本", noAccount: "未登录", updateRequested: "已开始检查更新。",
      layers: { white: "白噪音", pink: "粉红噪音", brown: "棕噪音", rain: "雨声", fire: "篝火", waves: "海浪", cafe: "咖啡馆", keyboard: "键盘" },
      states: { idle: "空闲", working: "专注", sleep: "睡眠" },
    },
  };

  function lang() { return snapshot && snapshot.lang === "zh" ? "zh" : "en"; }
  function t(key) {
    const table = TEXT[lang()];
    if (key.includes(".")) {
      const [root, child] = key.split(".");
      return (table[root] && table[root][child]) || TEXT.en[root]?.[child] || key;
    }
    return table[key] || TEXT.en[key] || key;
  }
  function value(key, fallback) { return snapshot && Object.prototype.hasOwnProperty.call(snapshot, key) ? snapshot[key] : fallback; }
  function esc(text) { const el = document.createElement("span"); el.textContent = String(text ?? ""); return el.innerHTML; }
  function toast(message, isError = false) {
    const stack = document.getElementById("toastStack");
    if (!stack) return;
    const item = document.createElement("div");
    item.className = `toast${isError ? " error" : ""}`;
    item.textContent = message;
    stack.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }
  function update(key, next) {
    return Promise.resolve(api.update(key, next)).then((result) => {
      if (!result || result.status !== "ok") throw new Error(result && result.message || "unknown error");
      toast(t("saved"));
      return result;
    }).catch((error) => { toast(t("failed") + (error.message || error), true); throw error; });
  }
  function row(label, control, description = "") {
    const item = document.createElement("div");
    item.className = "renmi-row";
    const text = document.createElement("label");
    text.innerHTML = `<span>${esc(label)}</span>${description ? `<small>${esc(description)}</small>` : ""}`;
    item.append(text, control);
    return item;
  }
  function checkbox(key, label, description) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value(key, false) === true;
    input.addEventListener("change", () => update(key, input.checked));
    return row(label, input, description);
  }
  function range(key, label, min, max, step, description, formatter = (v) => `${Math.round(v * 100)}%`) {
    const wrap = document.createElement("div");
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value(key, min));
    const output = document.createElement("span"); output.className = "renmi-pill"; output.textContent = formatter(Number(input.value));
    input.addEventListener("input", () => { output.textContent = formatter(Number(input.value)); });
    input.addEventListener("change", () => update(key, Number(input.value)));
    wrap.append(input, output);
    return row(label, wrap, description);
  }
  function select(key, label, options, description) {
    const input = document.createElement("select");
    for (const option of options) {
      const item = document.createElement("option"); item.value = option.value; item.textContent = option.label; item.selected = option.value === value(key, options[0]?.value); input.appendChild(item);
    }
    input.addEventListener("change", () => update(key, input.value));
    return row(label, input, description);
  }
  function button(label, onClick, primary = false) {
    const input = document.createElement("button"); input.className = `renmi-button${primary ? " primary" : ""}`; input.type = "button"; input.textContent = label; input.addEventListener("click", onClick); return input;
  }
  function section(title, description, children) {
    const wrapper = document.createElement("section");
    const heading = document.createElement("h1"); heading.textContent = title; wrapper.appendChild(heading);
    if (description) { const note = document.createElement("p"); note.className = "renmi-settings-note"; note.textContent = description; wrapper.appendChild(note); }
    const card = document.createElement("div"); card.className = "section"; children.forEach((child) => card.appendChild(child)); wrapper.appendChild(card); return wrapper;
  }

  function renderSidebar() {
    sidebar.innerHTML = "";
    for (const [id, labelKey] of [["general", "general"], ["theme", "theme"], ["ambient", "ambient"], ["animation", "animation"], ["shortcuts", "shortcuts"], ["about", "about"]]) {
      const item = document.createElement("div"); item.className = `sidebar-item${id === activeTab ? " active" : ""}`; item.textContent = t(labelKey); item.addEventListener("click", () => { activeTab = id; render(); }); sidebar.appendChild(item);
    }
  }

  function renderGeneral() {
    const languages = [{ value: "en", label: "English" }, { value: "zh", label: "简体中文" }, { value: "zh-TW", label: "繁體中文" }, { value: "ko", label: "한국어" }, { value: "ja", label: "日本語" }, { value: "pt-BR", label: "Português" }, { value: "es", label: "Español" }];
    const sizes = [{ value: "P:6", label: "Small" }, { value: "P:9", label: "Medium" }, { value: "P:13", label: "Large" }, { value: "P:18", label: "Extra large" }];
    const children = [select("lang", t("language"), languages), select("size", t("size"), sizes), checkbox("showTray", t("showTray")), checkbox("showDock", t("showDock")), checkbox("openAtLogin", t("openAtLogin")), checkbox("freeRoam", t("freeRoam")), checkbox("allowEdgePinning", t("edgePin")), checkbox("disableMiniMode", t("mini")), checkbox("lowPowerIdleMode", t("lowPower")), checkbox("studyFollowPet", t("studyFollowPet")), checkbox("soundMuted", t("soundMuted")), range("soundVolume", t("soundVolume"), 0, 1, 0.01)];
    const actions = document.createElement("div"); actions.className = "renmi-actions"; actions.append(button(t("study"), () => api.openStudy(), true), button(t("hide"), () => api.command("hidePet"))); children.push(actions);
    return section(t("generalTitle"), t("generalDesc"), children);
  }

  function themeLabel(theme) { return typeof theme.name === "string" ? theme.name : theme.name && (theme.name[lang()] || theme.name.en) || theme.id; }
  function renderTheme() {
    const children = [];
    const grid = document.createElement("div"); grid.className = "renmi-card-grid";
    for (const theme of themes) {
      const card = document.createElement("div"); card.className = `renmi-theme-card${theme.active ? " active" : ""}`;
      if (theme.previewFileUrl) { const img = document.createElement("img"); img.src = theme.previewFileUrl; img.alt = themeLabel(theme); card.appendChild(img); }
      const name = document.createElement("div"); name.className = "renmi-theme-card-name"; name.textContent = `${themeLabel(theme)}${theme.active ? ` · ${t("active")}` : ""}`; card.appendChild(name);
      card.addEventListener("click", () => api.command("setThemeSelection", { themeId: theme.id }).then((result) => { if (!result || result.status !== "ok") throw new Error(result?.message || "theme activation failed"); } ).catch((error) => toast(t("failed") + error.message, true)));
      grid.appendChild(card);
    }
    children.push(grid);
    const currentTheme = themes.find((item) => item.active) || { id: value("theme", "renmi") };
    if (currentTheme.id === "renmi") {
      const tintOptions = [{ value: "none", label: t("tintNone") }, { value: "cream", label: t("tintCream") }, { value: "light-gray", label: t("tintGray") }, { value: "light-brown", label: t("tintBrown") }];
      const tintMap = value("petTint", {}) || {};
      const tintSelect = select("petTintChoice", t("tint"), tintOptions);
      const input = tintSelect.querySelector("select"); input.value = tintMap.renmi || "none";
      input.addEventListener("change", () => { const next = { ...tintMap }; if (input.value === "none") delete next.renmi; else next.renmi = input.value; update("petTint", next); });
      const saturationMap = value("petTintSaturation", {}) || {};
      const saturationRow = document.createElement("div"); saturationRow.className = "renmi-row";
      const saturationLabel = document.createElement("label"); saturationLabel.textContent = t("saturation");
      const saturationInput = document.createElement("input"); saturationInput.type = "range"; saturationInput.min = "0"; saturationInput.max = "200"; saturationInput.step = "1"; saturationInput.value = String(Number.isFinite(saturationMap.renmi) ? saturationMap.renmi : 100);
      const saturationValue = document.createElement("span"); saturationValue.className = "renmi-pill"; saturationValue.textContent = `${saturationInput.value}%`;
      saturationInput.addEventListener("input", () => { saturationValue.textContent = `${saturationInput.value}%`; });
      saturationInput.addEventListener("change", () => update("petTintSaturation", { ...saturationMap, renmi: Number(saturationInput.value) }));
      saturationRow.append(saturationLabel, saturationInput, saturationValue);
      children.push(tintSelect, saturationRow);
    }
    return section(t("themeTitle"), t("themeDesc"), children);
  }

  function renderAmbient() {
    const layers = value("ambientLayers", {}) || {};
    const children = [checkbox("ambientEnabled", t("enabled")), range("ambientMasterVolume", t("master"), 0, 1, 0.01)];
    for (const name of ["white", "pink", "brown", "rain", "fire", "waves", "cafe", "keyboard"]) {
      const input = document.createElement("input"); input.type = "range"; input.min = "0"; input.max = "1"; input.step = "0.01"; input.value = String(layers[name] || 0); input.disabled = value("ambientEnabled", false) !== true; input.addEventListener("change", () => update("ambientLayers", { ...layers, [name]: Number(input.value) })); children.push(row(`${t("layers." + name)}`, input));
    }
    children.push(checkbox("ambientAutoStateBinding", t("stateBinding")));
    const actions = document.createElement("div"); actions.className = "renmi-actions"; actions.append(button(t("reset"), () => Promise.all([update("ambientLayers", { white: 0, pink: 0, brown: 0.3, rain: 0.5, fire: 0, waves: 0, cafe: 0, keyboard: 0 }), update("ambientMasterVolume", 0.6)]))); children.push(actions);
    return section(t("ambientTitle"), t("ambientDesc"), children);
  }

  function renderAnimation() {
    const choices = [{ value: "", label: t("defaultVisual") }];
    const visuals = themes.find((item) => item.active)?.idleVisuals || [];
    for (const file of visuals) choices.push({ value: file, label: file });
    const currentTheme = value("theme", "renmi"); const map = value("idleVisual", {}) || {};
    const visualSelect = select("idleVisualChoice", t("idleVisual"), choices);
    const visualInput = visualSelect.querySelector("select"); visualInput.value = map[currentTheme] || ""; visualInput.addEventListener("change", () => { const next = { ...map }; if (visualInput.value) next[currentTheme] = visualInput.value; else delete next[currentTheme]; update("idleVisual", next); });
    return section(t("animationTitle"), t("animationDesc"), [visualSelect, checkbox("soundMuted", t("mute")), range("soundVolume", t("volume"), 0, 1, 0.01)]);
  }

  function renderShortcuts() {
    const wrap = document.createElement("div"); wrap.className = "renmi-actions";
    const input = document.createElement("input"); input.type = "text"; input.value = value("shortcuts", {}).togglePet || ""; input.placeholder = t("shortcutPlaceholder");
    wrap.append(input, button(t("apply"), () => api.command("registerShortcut", { actionId: "togglePet", accelerator: input.value || null }).then((result) => { if (!result || result.status !== "ok") throw new Error(result?.message || "shortcut failed"); toast(t("saved")); }).catch((error) => toast(t("failed") + error.message, true))), button(t("resetShortcut"), () => api.command("resetShortcut", { actionId: "togglePet" }).then(() => toast(t("saved")))));
    return section(t("shortcutTitle"), t("shortcutDesc"), [row(t("togglePet"), wrap)]);
  }

  function renderAbout() {
    const actions = document.createElement("div"); actions.className = "renmi-actions"; actions.append(button(t("signIn"), () => api.openAuth()), button(t("signOut"), () => api.logout()), button(t("updates"), () => api.checkForUpdates().then(() => toast(t("updateRequested"))), false));
    return section(t("aboutTitle"), t("aboutDesc"), [row(t("account"), document.createTextNode(t("noAccount"))), row(t("version"), document.createTextNode("0.16.0")), actions]);
  }

  function render() {
    renderSidebar(); content.innerHTML = "";
    if (!snapshot) return;
    const page = activeTab === "theme" ? renderTheme() : activeTab === "ambient" ? renderAmbient() : activeTab === "animation" ? renderAnimation() : activeTab === "shortcuts" ? renderShortcuts() : activeTab === "about" ? renderAbout() : renderGeneral();
    content.appendChild(page);
  }

  api.onChanged((payload) => { if (!payload) return; snapshot = payload.snapshot || { ...snapshot, ...(payload.changes || {}) }; render(); });
  Promise.all([api.getSnapshot(), api.listThemes()]).then(([next, list]) => { snapshot = next; themes = Array.isArray(list) ? list : []; render(); }).catch((error) => { content.textContent = error.message || String(error); });
})();
