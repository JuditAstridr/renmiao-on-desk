"use strict";

// Electron's single production composition root. Renmi is a study and focus
// companion; the former coding-agent runtime is intentionally not part of the
// application process anymore.

const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const { configureElectronApp } = require("./renmi-profile");

const renmiProfile = configureElectronApp(app);
if (!renmiProfile) {
  throw new Error("Renmi profile is disabled; the standalone Renmi app cannot start in legacy mode");
}

// Keep the packaged native smoke mode available to the release pipeline
// without loading any desktop runtime or external integration code.
const { maybeRunPackageKoffiSmoke } = require("./package-koffi-smoke");
if (maybeRunPackageKoffiSmoke({ app, BrowserWindow })) {
  return;
}

process.env.RENMI_ON_DESK_ROAM_FENCE_PATH = path.join(
  renmiProfile.userDataDir,
  "roam-area.json",
);

require("./main-renmi");
