"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { registerStudyIpc } = require("../src/study-ipc");

function makeIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, listener) { handlers.set(channel, listener); },
    removeHandler(channel) { handlers.delete(channel); },
  };
}

describe("study IPC boundary", () => {
  it("registers isolated task/timer handlers and broadcasts mutations", async () => {
    const ipcMain = makeIpcMain();
    const webContents = {};
    const studyWindow = { webContents, isDestroyed: () => false };
    const calls = [];
    const runtime = {
      getSnapshot: () => ({ tasks: [], pomodoro: {}, view: {} }),
      addTask: (payload) => { calls.push(["addTask", payload]); return { ok: true }; },
      pomodoroCommand: (command) => { calls.push(["pomodoroCommand", command]); return { ok: true }; },
    };
    const broadcasts = [];
    const registration = registerStudyIpc({
      ipcMain,
      studyRuntime: runtime,
      getI18n: () => ({ lang: "zh-CN" }),
      getStudyWindow: () => studyWindow,
      broadcast: (snapshot) => broadcasts.push(snapshot),
    });

    const event = { sender: webContents };
    const result = await ipcMain.handlers.get("study:add-task")(event, { title: "T" });
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, [["addTask", { title: "T" }]]);
    assert.deepEqual(broadcasts, [{ ok: true }]);
    assert.equal(ipcMain.handlers.get("study:pomodoro-command")(event, "start").ok, true);
    assert.deepEqual(await ipcMain.handlers.get("study:get-i18n")(event), { lang: "zh-CN" });

    const rejected = await ipcMain.handlers.get("study:get-snapshot")({ sender: {} });
    assert.deepEqual(rejected, { status: "error", message: "untrusted-study-sender" });
    registration.dispose();
    assert.equal(ipcMain.handlers.size, 0);
  });

  it("keeps poster resources behind the trusted Study sender boundary", async () => {
    const ipcMain = makeIpcMain();
    const webContents = {};
    const studyWindow = { webContents, isDestroyed: () => false };
    const posterAssets = {
      getActivePet: () => ({ id: "renmi" }),
      getPosterAssets: (ids) => ({ requested: ids }),
      getPosterFont: () => ({ base64: "font" }),
    };
    const registration = registerStudyIpc({
      ipcMain,
      studyRuntime: { getSnapshot: () => ({}) },
      posterAssets,
      getStudyWindow: () => studyWindow,
    });
    const event = { sender: webContents };
    assert.deepEqual(await ipcMain.handlers.get("study:get-poster-active-pet")(event), { id: "renmi" });
    assert.deepEqual(await ipcMain.handlers.get("study:get-poster-assets")(event, ["icon-focus"]), { requested: ["icon-focus"] });
    assert.deepEqual(await ipcMain.handlers.get("study:get-poster-font")(event), { base64: "font" });
    assert.deepEqual(await ipcMain.handlers.get("study:get-poster-font")({ sender: {} }), { status: "error", message: "untrusted-study-sender" });
    registration.dispose();
  });

  it("accepts the trusted Settings window for an embedded Study page", async () => {
    const ipcMain = makeIpcMain();
    const studyWebContents = {};
    const settingsWebContents = {};
    const registration = registerStudyIpc({
      ipcMain,
      studyRuntime: { getSnapshot: () => ({ embedded: true }) },
      getStudyWindow: () => ({ webContents: studyWebContents, isDestroyed: () => false }),
      getSettingsWindow: () => ({ webContents: settingsWebContents, isDestroyed: () => false }),
    });

    assert.deepEqual(
      await ipcMain.handlers.get("study:get-snapshot")({ sender: settingsWebContents }),
      { embedded: true },
    );
    assert.deepEqual(
      await ipcMain.handlers.get("study:get-snapshot")({ sender: {} }),
      { status: "error", message: "untrusted-study-sender" },
    );
    registration.dispose();
  });
});
