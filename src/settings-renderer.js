"use strict";

const core = globalThis.ClawdSettingsCore;

// Icons resolve via settings-icons.js at render time (keyed by tab id),
// not as emoji/unicode glyphs \u2014 those rendered inconsistently across
// system fonts and didn't dark-mode well.
const SIDEBAR_TABS = [
  { id: "general", labelKey: "sidebarGeneral", available: true },
  { id: "study", labelKey: "sidebarStudy", action: "embeddedStudy", available: true },
  { id: "theme", labelKey: "sidebarTheme", available: true },
  { id: "ambient", labelKey: "sidebarAmbient", available: true },
  { id: "animOverrides", labelKey: "sidebarAnimOverrides", available: true },
  { id: "shortcuts", labelKey: "sidebarShortcuts", available: true },
];

function getTabIcon(tabId) {
  const icons = globalThis.ClawdSettingsIcons;
  if (icons && typeof icons.getIcon === "function") return icons.getIcon(tabId);
  return "";
}

function renderSidebar() {
  document.title = core.helpers.t("settingsWindowTitle");
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  sidebar.innerHTML = "";
  for (const tab of SIDEBAR_TABS) {
    const item = document.createElement("div");
    item.className = "sidebar-item";
    if (!tab.available) item.classList.add("disabled");
    if (tab.id === core.state.activeTab) item.classList.add("active");
    // Icon HTML is trusted (it comes from our own settings-icons.js
    // module, not user input), so we drop it in as-is.
    item.innerHTML =
      `<span class="sidebar-item-icon">${getTabIcon(tab.id)}</span>` +
      `<span class="sidebar-item-label">${core.helpers.escapeHtml(core.helpers.t(tab.labelKey))}</span>` +
      (tab.available ? "" : `<span class="sidebar-item-soon">${core.helpers.escapeHtml(core.helpers.t("sidebarSoon"))}</span>`);
    if (tab.available && tab.action === "embeddedStudy") {
      item.addEventListener("click", () => {
        core.ops.selectTab(tab.id);
      });
    } else if (tab.available) {
      item.addEventListener("click", () => {
        core.ops.selectTab(tab.id);
      });
    }
    sidebar.appendChild(item);
  }
}

function renderStudyEmbedded(content) {
  const frame = document.createElement("iframe");
  frame.className = "study-settings-frame";
  frame.title = core.helpers.t("sidebarStudy");
  frame.src = "study-dashboard.html?embedded=1";
  frame.setAttribute("loading", "eager");
  content.appendChild(frame);
}

function renderPlaceholder(parent) {
  const div = document.createElement("div");
  div.className = "placeholder";
  div.innerHTML =
    `<div class="placeholder-icon">${getTabIcon("placeholder")}</div>` +
    `<div class="placeholder-title">${core.helpers.escapeHtml(core.helpers.t("placeholderTitle"))}</div>` +
    `<div class="placeholder-desc">${core.helpers.escapeHtml(core.helpers.t("placeholderDesc"))}</div>`;
  parent.appendChild(div);
}

function renderContent() {
  const content = document.getElementById("content");
  if (!content) return;
  core.ops.clearMountedControls();
  content.classList.toggle("study-embedded", core.state.activeTab === "study");
  content.innerHTML = "";
  const tab = core.tabs[core.state.activeTab];
  if (tab && typeof tab.render === "function") {
    tab.render(content, core);
  } else {
    renderPlaceholder(content);
  }
}

core.tabs.study = { render: renderStudyEmbedded };

core.ops.installRenderHooks({
  sidebar: renderSidebar,
  content: renderContent,
});

globalThis.ClawdSettingsTabGeneral.init(core);
globalThis.ClawdSettingsTabTheme.init(core);
globalThis.ClawdSettingsTabAmbient.init(core);
// Not a top-level tab anymore — it provides the "on / off" subtab that
// ClawdSettingsTabAnimOverrides renders. init() just wires up the core refs.
globalThis.ClawdSettingsTabAnimMap.init(core);
globalThis.ClawdSettingsTabAnimOverrides.init(core);
globalThis.ClawdSettingsTabShortcuts.init(core);

core.ops.restoreNavigationState();
if (typeof window.addEventListener === "function") {
  window.addEventListener("beforeunload", () => core.ops.persistNavigationState());
}

if (window.settingsAPI && typeof window.settingsAPI.onChanged === "function") {
  window.settingsAPI.onChanged((payload) => core.ops.applyChanges(payload));
}

if (window.settingsAPI && typeof window.settingsAPI.onAnimationPreviewPosterReady === "function") {
  window.settingsAPI.onAnimationPreviewPosterReady((payload) => core.ops.applyAnimationPreviewPoster(payload));
}

if (window.settingsAPI && typeof window.settingsAPI.onShortcutRecordKey === "function") {
  window.settingsAPI.onShortcutRecordKey((payload) => core.ops.handleShortcutRecordKey(payload));
}

if (window.settingsAPI && typeof window.settingsAPI.onShortcutFailuresChanged === "function") {
  window.settingsAPI.onShortcutFailuresChanged((failures) => core.ops.applyShortcutFailures(failures));
}

if (window.settingsAPI && typeof window.settingsAPI.onPetAccessoryOptionsChanged === "function") {
  window.settingsAPI.onPetAccessoryOptionsChanged(() => {
    if (typeof window.settingsAPI.getPetAccessoryOptions !== "function") return;
    window.settingsAPI.getPetAccessoryOptions().then((options) => {
      core.runtime.petAccessoryOptions = Array.isArray(options) ? options : [];
      if (core.state && core.state.activeTab === "theme") {
        core.ops.requestRender({ content: true });
      }
    }).catch((err) => {
      console.warn("settings: refresh pet accessory options failed", err);
    });
  });
}

if (window.settingsAPI && typeof window.settingsAPI.onPetSkinOptionsChanged === "function") {
  window.settingsAPI.onPetSkinOptionsChanged(() => {
    if (typeof window.settingsAPI.getPetSkinOptions !== "function") return;
    window.settingsAPI.getPetSkinOptions().then((options) => {
      core.runtime.petSkinOptions = Array.isArray(options) ? options : [];
      if (core.state && core.state.activeTab === "theme") {
        core.ops.requestRender({ content: true });
      }
    }).catch((err) => {
      console.warn("settings: refresh pet skin options failed", err);
    });
  });
}

if (window.settingsAPI && typeof window.settingsAPI.getShortcutFailures === "function") {
  window.settingsAPI.getShortcutFailures().then((failures) => {
    core.ops.applyShortcutFailures(failures);
  }).catch((err) => {
    console.warn("settings: getShortcutFailures failed", err);
  });
}

if (window.settingsAPI && typeof window.settingsAPI.getSnapshot === "function") {
  const tintOptionsPromise =
    typeof window.settingsAPI.getPetTintOptions === "function"
      ? window.settingsAPI.getPetTintOptions().catch((err) => {
        console.warn("settings: getPetTintOptions failed", err);
        return [];
      })
      : Promise.resolve([]);
  const accessoryOptionsPromise =
    typeof window.settingsAPI.getPetAccessoryOptions === "function"
      ? window.settingsAPI.getPetAccessoryOptions().catch((err) => {
        console.warn("settings: getPetAccessoryOptions failed", err);
        return [];
      })
      : Promise.resolve([]);
  const skinOptionsPromise =
    typeof window.settingsAPI.getPetSkinOptions === "function"
      ? window.settingsAPI.getPetSkinOptions().catch((err) => {
        console.warn("settings: getPetSkinOptions failed", err);
        return [];
      })
      : Promise.resolve([]);
  Promise.all([
    window.settingsAPI.getSnapshot(),
    tintOptionsPromise,
    skinOptionsPromise,
    accessoryOptionsPromise,
  ]).then(([snapshot, petTintOptions, petSkinOptions, petAccessoryOptions]) => {
    core.runtime.petTintOptions = Array.isArray(petTintOptions) ? petTintOptions : [];
    core.runtime.petSkinOptions = Array.isArray(petSkinOptions) ? petSkinOptions : [];
    core.runtime.petAccessoryOptions = Array.isArray(petAccessoryOptions)
      ? petAccessoryOptions
      : [];
    core.ops.applyBootstrap(snapshot);
  });
}
