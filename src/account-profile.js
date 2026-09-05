"use strict";

// Account-scoped data shared by the Electron client and the cloud API. This
// module stays under src/ so packaged Renmiao builds can use the same profile
// defaults and sanitization without shipping the cloud server itself.

const { defaultState, sanitizeState } = require("./study-runtime");

const PROFILE_VERSION = 1;
const MAX_TASKS = 500;
const MAX_SUBTASKS = 100;
const MAX_PROFILE_BYTES = 512 * 1024;
const SAFE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const SAFE_FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,159}$/;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function defaultPet() {
  return {
    themeId: "renmi",
    variantId: "default",
    tintId: "none",
    accessoryId: "none",
    holidayAccessoryEnabled: false,
    idleVisual: "",
  };
}

function defaultProfile() {
  return {
    version: PROFILE_VERSION,
    pet: defaultPet(),
    study: defaultState(),
  };
}

function safeId(value, fallback) {
  const text = typeof value === "string" ? value.trim() : "";
  return SAFE_ID_RE.test(text) ? text : fallback;
}

function sanitizePet(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const pet = defaultPet();
  pet.themeId = safeId(source.themeId, pet.themeId);
  pet.variantId = safeId(source.variantId, pet.variantId);
  pet.tintId = safeId(source.tintId, pet.tintId);
  pet.accessoryId = safeId(source.accessoryId, pet.accessoryId);
  pet.holidayAccessoryEnabled = source.holidayAccessoryEnabled === true;
  const idleVisual = typeof source.idleVisual === "string" ? source.idleVisual.trim() : "";
  pet.idleVisual = idleVisual && SAFE_FILE_RE.test(idleVisual) ? idleVisual : "";
  return pet;
}

function sanitizeStudy(raw) {
  const state = sanitizeState(raw);
  state.tasks = state.tasks.slice(0, MAX_TASKS).map((task) => ({
    ...task,
    subtasks: Array.isArray(task.subtasks) ? task.subtasks.slice(0, MAX_SUBTASKS) : [],
  }));
  return sanitizeState(state);
}

function sanitizeProfile(raw) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const profile = {
    version: PROFILE_VERSION,
    pet: sanitizePet(source.pet),
    study: sanitizeStudy(source.study),
  };
  if (Buffer.byteLength(JSON.stringify(profile), "utf8") > MAX_PROFILE_BYTES) {
    profile.study.tasks = profile.study.tasks.slice(0, 100);
    profile.study = sanitizeStudy(profile.study);
  }
  return profile;
}

function profileFromRow(row) {
  return sanitizeProfile(row && row.profile_state);
}

function profileUpdatedAt(row) {
  return row && (row.profile_updated_at || row.updated_at) || null;
}

function hasMeaningfulStudyState(raw) {
  const state = sanitizeStudy(raw);
  const points = state.points || {};
  const pomodoro = state.pomodoro || {};
  return state.tasks.length > 0
    || state.view.sortBy !== "created"
    || state.view.groupBy !== "none"
    || points.total > 0
    || points.today > 0
    || points.streak > 0
    || points.bestStreak > 0
    || pomodoro.phase !== "idle"
    || pomodoro.running === true
    || pomodoro.totalFocusCycles > 0;
}

function profileSummary(raw) {
  const profile = sanitizeProfile(raw);
  const study = profile.study;
  const activeTask = study.tasks.find((task) => task.id === study.pomodoro.taskId) || null;
  return {
    themeId: profile.pet.themeId,
    variantId: profile.pet.variantId,
    taskCount: study.tasks.length,
    completedTaskCount: study.tasks.filter((task) => task.done).length,
    activeTaskTitle: activeTask ? activeTask.title : "",
    pomodoroPhase: study.pomodoro.phase,
    pomodoroRunning: study.pomodoro.running === true,
    pointsTotal: study.points.total,
    streak: study.points.streak,
  };
}

module.exports = {
  PROFILE_VERSION,
  MAX_PROFILE_BYTES,
  defaultProfile,
  sanitizeProfile,
  profileFromRow,
  profileUpdatedAt,
  profileSummary,
  hasMeaningfulStudyState,
};
