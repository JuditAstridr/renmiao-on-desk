"use strict";

const defaultPath = require("path");

const PROFILE_ENV = "RENMI_ON_DESK_PROFILE";
const APP_NAME = "renmiao";
const USER_DATA_DIR_NAME = "renmiao-dev";

function isEnabled(env = process.env) {
  return !env || env[PROFILE_ENV] !== "0";
}

function configureElectronApp(app, options = {}) {
  if (!isEnabled(options.env || process.env)) return null;
  if (!app || typeof app.getPath !== "function" || typeof app.setPath !== "function") {
    throw new TypeError("configureElectronApp requires an Electron app");
  }

  const path = options.path || defaultPath;
  const userDataDir = path.join(app.getPath("appData"), USER_DATA_DIR_NAME);
  app.setName(APP_NAME);
  app.setPath("userData", userDataDir);
  return Object.freeze({
    appName: APP_NAME,
    userDataDir,
    runtimeConfigPath: path.join(userDataDir, "runtime.json"),
  });
}

module.exports = {
  APP_NAME,
  PROFILE_ENV,
  USER_DATA_DIR_NAME,
  configureElectronApp,
  isEnabled,
};
