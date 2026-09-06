"use strict";

// Study companion runtime.  This module intentionally has no Electron
// dependency: the main process owns one instance and the Study window talks
// to it through IPC.  Agent sessions continue to use src/state.js separately.

const fs = require("fs");

const DEFAULT_FOCUS_MIN = 25;
const DEFAULT_SHORT_BREAK_MIN = 5;
const FOCUS_MINUTE_OPTIONS = Object.freeze([15, 25, 30, 45]);
const MODES = Object.freeze(["countdown", "countup"]);
const PHASES = Object.freeze(["idle", "focus", "shortBreak", "longBreak"]);
const QUADRANTS = Object.freeze([0, 1, 2, 3]);
const SORT_OPTIONS = Object.freeze(["created", "deadline", "estimate", "estimateDesc", "quadrant"]);
const GROUP_OPTIONS = Object.freeze(["none", "category", "quadrant"]);
const HISTORY_LIMIT = 2000;
const HISTORY_MAX_AGE_MS = 400 * 86400000;

function defaultPomodoro() {
  return {
    phase: "idle",
    running: false,
    mode: "countdown",
    elapsedSeconds: 0,
    awardedFocusSeconds: 0,
    sessionFocusSeconds: 0,
    taskId: null,
    taskTotalSeconds: 0,
    taskRemainingSeconds: 0,
    subtaskIds: [],
    currentSubtaskId: null,
    currentSubtaskRemainingSeconds: 0,
    splitLongSubtasks: false,
    remainingSeconds: DEFAULT_FOCUS_MIN * 60,
    totalSeconds: DEFAULT_FOCUS_MIN * 60,
    focusMinutes: DEFAULT_FOCUS_MIN,
    shortBreakMinutes: DEFAULT_SHORT_BREAK_MIN,
    completedFocusCycles: 0,
    totalFocusCycles: 0,
    pauseBetweenCycles: true,
    awaitingContinue: false,
  };
}

function defaultPoints() {
  return { total: 0, today: 0, streak: 0, bestStreak: 0, lastAwardDate: "" };
}

function defaultGoals() {
  return { defaultMinutes: null, defaultName: "", defaultDescription: "", overrides: {}, overrideNames: {}, overrideDescriptions: {}, items: [] };
}

function sanitizePoints(raw) {
  const base = defaultPoints();
  if (!raw || typeof raw !== "object") return base;
  const out = { ...base };
  for (const key of ["total", "today", "streak", "bestStreak"]) {
    const value = Number(raw[key]);
    if (Number.isInteger(value) && value >= 0) out[key] = value;
  }
  out.lastAwardDate = typeof raw.lastAwardDate === "string" ? raw.lastAwardDate.slice(0, 32) : "";
  return out;
}

function localDayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clockToMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 && minutes < 1440 ? minutes : null;
}

function normalizeScheduleClock(timeMinutes, endTimeMinutes) {
  const start = clockToMinutes(timeMinutes);
  let end = clockToMinutes(endTimeMinutes);
  if (start !== null && end !== null && end < start) end = null;
  return { start, end };
}

function sanitizeGoals(raw) {
  const out = defaultGoals();
  if (!raw || typeof raw !== "object") return out;
  const defaultMinutes = Number(raw.defaultMinutes);
  if (Number.isInteger(defaultMinutes) && defaultMinutes > 0 && defaultMinutes <= 1440) {
    out.defaultMinutes = defaultMinutes;
  }
  out.defaultName = cleanText(raw.defaultName, 120);
  out.defaultDescription = cleanText(raw.defaultDescription, 500);
  if (raw.overrides && typeof raw.overrides === "object") {
    for (const [key, value] of Object.entries(raw.overrides)) {
      const minutes = Number(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(key)
        && Number.isInteger(minutes) && minutes > 0 && minutes <= 1440) {
        out.overrides[key] = minutes;
      }
    }
  }
  for (const [key, value] of Object.entries(raw.overrideNames || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out.overrideNames[key] = cleanText(value, 120);
  }
  for (const [key, value] of Object.entries(raw.overrideDescriptions || {})) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) out.overrideDescriptions[key] = cleanText(value, 500);
  }
  if (Array.isArray(raw.items)) {
    out.items = raw.items.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) return [];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return [];
      const minutes = Number(item.minutes);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return [];
      return [{ id: item.id.slice(0, 80), date: item.date, name: cleanText(item.name, 120), description: cleanText(item.description, 500), minutes }];
    });
  }
  return out;
}

function sanitizeSchedules(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id) return [];
    const title = cleanText(raw.title);
    if (!title) return [];
    const date = Number(raw.date);
    const clock = normalizeScheduleClock(raw.timeMinutes, raw.endTimeMinutes);
    return [{
      id: raw.id,
      title,
      date: Number.isFinite(date) && date > 0 ? Math.floor(date) : null,
      timeMinutes: clock.start,
      endTimeMinutes: clock.end,
      done: raw.done === true,
      category: sanitizeCategory(raw.category),
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    }];
  }).sort((a, b) => (a.date || 0) - (b.date || 0) || (a.createdAt || 0) - (b.createdAt || 0));
}

function sanitizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const clean = [];
  for (const event of raw) {
    if (!event || typeof event !== "object" || !Number.isFinite(event.at)) continue;
    const at = Math.floor(event.at);
    const points = Number(event.points);
    if (!Number.isInteger(points) || points < 0) continue;
    if (event.kind === "focus") {
      const minutes = Number(event.minutes);
      if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 720) continue;
      clean.push({
        kind: "focus", at, minutes, points,
        taskId: typeof event.taskId === "string" && event.taskId ? event.taskId : null,
        taskTitle: typeof event.taskTitle === "string" ? cleanText(event.taskTitle, 300) : null,
        category: sanitizeCategory(event.category),
      });
    } else if (event.kind === "task" && typeof event.taskId === "string" && event.taskId) {
      const taskTitle = cleanText(event.taskTitle);
      if (!taskTitle) continue;
      const deadline = Number(event.deadline);
      const startedAt = Number(event.startedAt);
      const elapsedMinutes = Number(event.elapsedMinutes);
      const focusMinutes = Number(event.focusMinutes);
      clean.push({
        kind: "task", at, points, taskId: event.taskId, taskTitle,
        category: sanitizeCategory(event.category),
        quadrant: QUADRANTS.includes(event.quadrant) ? event.quadrant : null,
        deadline: Number.isFinite(deadline) && deadline > 0 ? deadline : null,
        startedAt: Number.isFinite(startedAt) && startedAt > 0 ? startedAt : null,
        focusMinutes: Number.isInteger(focusMinutes) && focusMinutes >= 0 ? focusMinutes : 0,
        elapsedMinutes: Number.isInteger(elapsedMinutes) && elapsedMinutes >= 0 ? elapsedMinutes : null,
      });
    }
  }
  clean.sort((a, b) => a.at - b.at);
  return clean.slice(-HISTORY_LIMIT);
}

function defaultState() {
  return {
    tasks: [],
    pomodoro: defaultPomodoro(),
    view: { sortBy: "created", groupBy: "none" },
    points: defaultPoints(),
    history: [],
    schedules: [],
    goals: defaultGoals(),
  };
}

function cleanText(value, max = 500) {
  if (typeof value !== "string") return "";
  return value.replace(/\0/g, "").trim().slice(0, max);
}

function sanitizeCategory(value) {
  const category = cleanText(value, 80);
  return category || null;
}

function sanitizeDeadline(value) {
  if (value === null || value === undefined || value === "") return null;
  const deadline = Number(value);
  return Number.isFinite(deadline) && deadline > 0 ? deadline : null;
}

function sanitizeMinutes(value, max = 600) {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= max ? minutes : null;
}

function sanitizeSubtasks(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const title = cleanText(raw.title);
    if (!raw.id || !title) return [];
    return [{
      id: String(raw.id),
      title,
      done: raw.done === true,
      estimatedMinutes: sanitizeMinutes(raw.estimatedMinutes),
    }];
  });
}

function sanitizeView(raw) {
  const view = raw && typeof raw === "object" ? raw : {};
  return {
    sortBy: SORT_OPTIONS.includes(view.sortBy) ? view.sortBy : "created",
    groupBy: GROUP_OPTIONS.includes(view.groupBy) ? view.groupBy : "none",
  };
}

function sanitizePomodoro(raw, tasks) {
  const base = defaultPomodoro();
  if (!raw || typeof raw !== "object") return base;
  const out = { ...base };
  const focusMinutes = sanitizeMinutes(raw.focusMinutes, 180);
  const shortBreakMinutes = sanitizeMinutes(raw.shortBreakMinutes, 60);
  if (focusMinutes) out.focusMinutes = focusMinutes;
  if (shortBreakMinutes) out.shortBreakMinutes = shortBreakMinutes;
  out.phase = PHASES.includes(raw.phase) ? raw.phase : "idle";
  out.running = out.phase !== "idle" && raw.running === true;
  out.mode = MODES.includes(raw.mode) ? raw.mode : "countdown";
  out.elapsedSeconds = Number.isInteger(raw.elapsedSeconds) && raw.elapsedSeconds >= 0
    ? raw.elapsedSeconds : 0;
  out.awardedFocusSeconds = Number.isInteger(raw.awardedFocusSeconds) && raw.awardedFocusSeconds >= 0
    ? raw.awardedFocusSeconds : 0;
  out.sessionFocusSeconds = Number.isInteger(raw.sessionFocusSeconds) && raw.sessionFocusSeconds >= 0
    ? raw.sessionFocusSeconds : 0;
  out.taskId = typeof raw.taskId === "string" && raw.taskId ? raw.taskId : null;
  out.taskTotalSeconds = Number.isInteger(raw.taskTotalSeconds) && raw.taskTotalSeconds >= 0
    ? raw.taskTotalSeconds : 0;
  out.taskRemainingSeconds = Number.isInteger(raw.taskRemainingSeconds) && raw.taskRemainingSeconds >= 0
    ? raw.taskRemainingSeconds : 0;
  out.subtaskIds = Array.isArray(raw.subtaskIds)
    ? raw.subtaskIds.filter((id) => typeof id === "string" && id)
    : [];
  out.currentSubtaskId = typeof raw.currentSubtaskId === "string" && raw.currentSubtaskId
    ? raw.currentSubtaskId : null;
  out.currentSubtaskRemainingSeconds = Number.isInteger(raw.currentSubtaskRemainingSeconds)
    && raw.currentSubtaskRemainingSeconds >= 0 ? raw.currentSubtaskRemainingSeconds : 0;
  out.splitLongSubtasks = raw.splitLongSubtasks === true;
  out.completedFocusCycles = Number.isInteger(raw.completedFocusCycles) && raw.completedFocusCycles >= 0
    ? raw.completedFocusCycles : 0;
  out.totalFocusCycles = Number.isInteger(raw.totalFocusCycles) && raw.totalFocusCycles >= 0
    ? raw.totalFocusCycles : 0;
  out.pauseBetweenCycles = raw.pauseBetweenCycles !== false;
  out.awaitingContinue = raw.awaitingContinue === true;

  const task = out.taskId && Array.isArray(tasks)
    ? tasks.find((entry) => entry.id === out.taskId) : null;
  const subtask = task && out.currentSubtaskId
    ? (task.subtasks || []).find((entry) => entry.id === out.currentSubtaskId) : null;
  let total = out.focusMinutes * 60;
  if (out.phase === "shortBreak" || out.phase === "longBreak") {
    total = out.shortBreakMinutes * 60;
  } else if (out.phase === "focus" && subtask && subtask.estimatedMinutes) {
    total = out.splitLongSubtasks && out.currentSubtaskRemainingSeconds > 0
      ? Math.min(out.focusMinutes * 60, out.currentSubtaskRemainingSeconds)
      : subtask.estimatedMinutes * 60;
  } else if (out.phase === "focus" && out.taskRemainingSeconds > 0) {
    total = Math.min(out.focusMinutes * 60, out.taskRemainingSeconds);
  }
  out.totalSeconds = out.mode === "countup" ? 0 : total;
  const remaining = Number(raw.remainingSeconds);
  out.remainingSeconds = out.mode === "countup"
    ? 0
    : (Number.isFinite(remaining) && remaining >= 0 && remaining <= total ? Math.floor(remaining) : total);
  return out;
}

function sanitizeState(raw) {
  if (!raw || typeof raw !== "object") return defaultState();
  const tasks = Array.isArray(raw.tasks) ? raw.tasks.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const title = cleanText(entry.title);
    if (!entry.id || !title) return [];
    return [{
      id: String(entry.id),
      title,
      done: entry.done === true,
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : Date.now(),
      estimatedMinutes: sanitizeMinutes(entry.estimatedMinutes),
      completedPomodoros: Number.isInteger(entry.completedPomodoros) && entry.completedPomodoros >= 0
        ? entry.completedPomodoros : 0,
      focusMinutes: Number.isInteger(entry.focusMinutes) && entry.focusMinutes >= 0
        ? entry.focusMinutes : 0,
      startedAt: Number.isFinite(entry.startedAt) ? entry.startedAt : null,
      deadline: sanitizeDeadline(entry.deadline),
      category: sanitizeCategory(entry.category),
      quadrant: QUADRANTS.includes(entry.quadrant) ? entry.quadrant : null,
      completedAt: Number.isFinite(entry.completedAt) ? entry.completedAt : null,
      subtasks: sanitizeSubtasks(entry.subtasks),
    }];
  }) : [];
  return {
    tasks,
    pomodoro: sanitizePomodoro(raw.pomodoro, tasks),
    view: sanitizeView(raw.view),
    points: sanitizePoints(raw.points),
    history: sanitizeHistory(raw.history),
    schedules: sanitizeSchedules(raw.schedules),
    goals: sanitizeGoals(raw.goals),
  };
}

function effectiveMinutes(task) {
  const subtasks = Array.isArray(task && task.subtasks) ? task.subtasks : [];
  const sum = subtasks.reduce((total, subtask) => total + (subtask.estimatedMinutes || 0), 0);
  return sum > 0 ? sum : (task && task.estimatedMinutes);
}

function makeId(now) {
  return `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createStudyRuntime(options = {}) {
  if (typeof options.dataPath !== "string" || !options.dataPath) {
    throw new Error("createStudyRuntime requires options.dataPath");
  }
  const now = typeof options.now === "function" ? options.now : Date.now;
  const readFileSync = options.readFileSync || fs.readFileSync;
  const writeFileSync = options.writeFileSync || fs.writeFileSync;
  const setIntervalFn = options.setInterval || setInterval;
  const clearIntervalFn = options.clearInterval || clearInterval;
  const setTimeoutFn = options.setTimeout || setTimeout;
  const clearTimeoutFn = options.clearTimeout || clearTimeout;
  const onPhaseChange = typeof options.onPhaseChange === "function" ? options.onPhaseChange : () => {};
  const onFocusComplete = typeof options.onFocusComplete === "function" ? options.onFocusComplete : () => {};

  let state = load();
  let timer = null;
  let saveTimer = null;
  let lastTickAt = 0;
  let lastSaved = "";

  function load() {
    try {
      return sanitizeState(JSON.parse(readFileSync(options.dataPath, "utf8")));
    } catch {
      return defaultState();
    }
  }

  function persistNow() {
    if (saveTimer) {
      clearTimeoutFn(saveTimer);
      saveTimer = null;
    }
    const text = JSON.stringify(state, null, 2);
    if (text === lastSaved) return;
    try {
      writeFileSync(options.dataPath, text, "utf8");
      lastSaved = text;
    } catch (error) {
      console.warn("Clawd: failed to persist study data:", error && error.message);
    }
  }

  function persistSoon() {
    if (saveTimer) return;
    saveTimer = setTimeoutFn(() => {
      saveTimer = null;
      persistNow();
    }, 300);
    if (saveTimer && typeof saveTimer.unref === "function") saveTimer.unref();
  }

  function emitPhase() {
    try { onPhaseChange(state.pomodoro.phase, state.pomodoro.running); } catch (error) {
      console.warn("Clawd: study phase callback failed:", error && error.message);
    }
  }

  function awardPoints(reason) {
    const points = state.points;
    const today = localDayKey(now());
    if (points.lastAwardDate !== today) {
      points.today = 0;
      points.streak = points.lastAwardDate === localDayKey(now() - 86400000)
        ? points.streak + 1
        : 1;
      points.lastAwardDate = today;
      points.bestStreak = Math.max(points.bestStreak, points.streak);
    }
    let amount = reason === "focusMinute" ? 1
      : (reason === "focus" ? 10 : (reason === "task" ? 30 : (reason === "quadrant0" ? 15 : 0)));
    if (points.streak >= 3 && (reason === "focus" || reason === "task")) amount += 5;
    points.total += amount;
    points.today += amount;
    return amount;
  }

  function awardFocusTimePoints() {
    const pomodoro = state.pomodoro;
    const earnedMinutes = Math.floor(pomodoro.awardedFocusSeconds / 60);
    if (earnedMinutes <= 0) return;
    pomodoro.awardedFocusSeconds %= 60;
    for (let index = 0; index < earnedMinutes; index += 1) awardPoints("focusMinute");
  }

  function pushHistoryEvent(event) {
    state.history.push(event);
    const cutoff = now() - HISTORY_MAX_AGE_MS;
    state.history = state.history.filter((entry) => entry.at >= cutoff).slice(-HISTORY_LIMIT);
  }

  function recordFocusEvent(task, minutes) {
    if (!Number.isInteger(minutes) || minutes <= 0) return;
    pushHistoryEvent({
      kind: "focus",
      at: now(),
      minutes,
      // Focus-minute points are awarded incrementally while the timer runs.
      points: minutes,
      taskId: task ? task.id : null,
      taskTitle: task ? task.title : null,
      category: task ? task.category : null,
    });
  }

  function recordTaskEvent(task, points) {
    if (!task || task.completedAt == null) return;
    pushHistoryEvent({
      kind: "task",
      at: task.completedAt,
      points,
      taskId: task.id,
      taskTitle: task.title,
      category: task.category,
      quadrant: task.quadrant,
      deadline: task.deadline,
      startedAt: task.startedAt || task.createdAt,
      focusMinutes: task.focusMinutes || 0,
      elapsedMinutes: Math.max(0, Math.round((task.completedAt - task.createdAt) / 60000)),
    });
  }

  function markTaskComplete(task) {
    if (!task) return 0;
    task.done = true;
    const points = (task.quadrant === 0 ? awardPoints("quadrant0") : 0) + awardPoints("task");
    if (task.completedAt == null) {
      task.completedAt = now();
      recordTaskEvent(task, points);
    }
    return points;
  }

  function stopTimer() {
    if (timer) clearIntervalFn(timer);
    timer = null;
  }

  function ensureTimer() {
    if (timer) return;
    lastTickAt = now();
    timer = setIntervalFn(tick, 1000);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function focusSeconds(pomodoro) {
    const full = pomodoro.focusMinutes * 60;
    if (pomodoro.currentSubtaskId) {
      const task = state.tasks.find((entry) => entry.id === pomodoro.taskId);
      const subtask = task && (task.subtasks || []).find((entry) => entry.id === pomodoro.currentSubtaskId);
      if (subtask && subtask.estimatedMinutes) {
        const estimate = subtask.estimatedMinutes * 60;
        if (pomodoro.splitLongSubtasks && estimate > full) {
          return Math.min(full, pomodoro.currentSubtaskRemainingSeconds || estimate);
        }
        return estimate;
      }
    }
    return pomodoro.taskRemainingSeconds > 0
      ? Math.min(full, pomodoro.taskRemainingSeconds)
      : full;
  }

  function startPhase(phase, running = true) {
    const pomodoro = state.pomodoro;
    pomodoro.phase = phase;
    pomodoro.running = running === true;
    pomodoro.awaitingContinue = false;
    if (phase === "focus") pomodoro.sessionFocusSeconds = 0;
    if (pomodoro.mode === "countup") {
      pomodoro.totalSeconds = 0;
      pomodoro.remainingSeconds = 0;
    } else if (phase === "focus") {
      pomodoro.totalSeconds = focusSeconds(pomodoro);
      pomodoro.remainingSeconds = pomodoro.totalSeconds;
    } else {
      pomodoro.totalSeconds = pomodoro.shortBreakMinutes * 60;
      pomodoro.remainingSeconds = pomodoro.totalSeconds;
    }
    if (pomodoro.running) ensureTimer();
    else stopTimer();
    persistSoon();
    emitPhase();
  }

  function resetToIdle() {
    const pomodoro = state.pomodoro;
    pomodoro.phase = "idle";
    pomodoro.running = false;
    pomodoro.taskId = null;
    pomodoro.taskTotalSeconds = 0;
    pomodoro.taskRemainingSeconds = 0;
    pomodoro.subtaskIds = [];
    pomodoro.currentSubtaskId = null;
    pomodoro.currentSubtaskRemainingSeconds = 0;
    pomodoro.completedFocusCycles = 0;
    pomodoro.awaitingContinue = false;
    pomodoro.elapsedSeconds = 0;
    pomodoro.awardedFocusSeconds = 0;
    pomodoro.sessionFocusSeconds = 0;
    pomodoro.totalSeconds = pomodoro.focusMinutes * 60;
    pomodoro.remainingSeconds = pomodoro.totalSeconds;
  }

  function finishFocus() {
    const pomodoro = state.pomodoro;
    const taskId = pomodoro.taskId;
    const completedSeconds = pomodoro.totalSeconds;
    const actualFocusSeconds = Math.min(completedSeconds, pomodoro.sessionFocusSeconds || 0);
    const actualFocusMinutes = Math.floor(actualFocusSeconds / 60);
    pomodoro.completedFocusCycles += 1;
    pomodoro.totalFocusCycles += 1;
    if (taskId) {
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (task) task.completedPomodoros += 1;
      if (task) {
        recordFocusEvent(task, actualFocusMinutes);
        task.focusMinutes = (task.focusMinutes || 0) + actualFocusMinutes;
      }
      if (pomodoro.currentSubtaskId && task) {
        if (pomodoro.splitLongSubtasks && pomodoro.currentSubtaskRemainingSeconds > 0) {
          pomodoro.currentSubtaskRemainingSeconds = Math.max(
            0,
            pomodoro.currentSubtaskRemainingSeconds - completedSeconds,
          );
          if (pomodoro.currentSubtaskRemainingSeconds > 0) {
            startPhase("shortBreak");
            onFocusComplete({ taskId, taskFinished: false, intermediate: true });
            return;
          }
        }
        const subtask = (task.subtasks || []).find((entry) => entry.id === pomodoro.currentSubtaskId);
        if (subtask) subtask.done = true;
        pomodoro.subtaskIds = pomodoro.subtaskIds.filter((id) => id !== pomodoro.currentSubtaskId);
        const nextId = pomodoro.subtaskIds[0] || null;
        if (nextId) {
          pomodoro.currentSubtaskId = nextId;
          const next = (task.subtasks || []).find((entry) => entry.id === nextId);
          pomodoro.currentSubtaskRemainingSeconds = pomodoro.splitLongSubtasks && next && next.estimatedMinutes > pomodoro.focusMinutes
            ? next.estimatedMinutes * 60 : 0;
          pomodoro.phase = "idle";
          pomodoro.running = false;
          pomodoro.awaitingContinue = true;
          pomodoro.totalSeconds = pomodoro.focusMinutes * 60;
          pomodoro.remainingSeconds = pomodoro.totalSeconds;
          stopTimer();
          persistNow();
          emitPhase();
          onFocusComplete({ taskId, taskFinished: false, intermediate: true });
          return;
        }
        markTaskComplete(task);
        pomodoro.currentSubtaskId = null;
        pomodoro.currentSubtaskRemainingSeconds = 0;
        pomodoro.subtaskIds = [];
        pomodoro.taskId = null;
        pomodoro.taskTotalSeconds = 0;
        pomodoro.taskRemainingSeconds = 0;
        pomodoro.phase = "idle";
        pomodoro.running = false;
        pomodoro.totalSeconds = pomodoro.focusMinutes * 60;
        pomodoro.remainingSeconds = pomodoro.totalSeconds;
        stopTimer();
        persistNow();
        emitPhase();
        pomodoro.sessionFocusSeconds = 0;
        onFocusComplete({ taskId, taskFinished: true });
        return;
      }

      pomodoro.taskRemainingSeconds = Math.max(0, pomodoro.taskRemainingSeconds - completedSeconds);
      if (pomodoro.taskRemainingSeconds === 0) {
        markTaskComplete(task);
        pomodoro.taskId = null;
        pomodoro.taskTotalSeconds = 0;
        pomodoro.subtaskIds = [];
        pomodoro.phase = "idle";
        pomodoro.running = false;
        pomodoro.totalSeconds = pomodoro.focusMinutes * 60;
        pomodoro.remainingSeconds = pomodoro.totalSeconds;
        stopTimer();
        persistNow();
        emitPhase();
        pomodoro.sessionFocusSeconds = 0;
        onFocusComplete({ taskId, taskFinished: true });
        return;
      }
      startPhase("shortBreak");
      onFocusComplete({ taskId, taskFinished: false, intermediate: true });
      return;
    }

    recordFocusEvent(null, actualFocusMinutes);
    pomodoro.sessionFocusSeconds = 0;
    startPhase("shortBreak");
    onFocusComplete({ taskId: null, taskFinished: false });
  }

  function tick() {
    const pomodoro = state.pomodoro;
    if (!pomodoro.running || pomodoro.phase === "idle") return;
    const current = now();
    const elapsed = Math.max(0, Math.floor((current - lastTickAt) / 1000));
    lastTickAt = current;
    if (elapsed <= 0) return;
    if (pomodoro.mode === "countup") {
      pomodoro.elapsedSeconds += elapsed;
      if (pomodoro.phase === "focus") {
        pomodoro.sessionFocusSeconds += elapsed;
        pomodoro.awardedFocusSeconds += elapsed;
        awardFocusTimePoints();
      }
      persistSoon();
      return;
    }
    if (pomodoro.phase === "focus") {
      pomodoro.sessionFocusSeconds += elapsed;
      pomodoro.awardedFocusSeconds += elapsed;
      awardFocusTimePoints();
    }
    pomodoro.remainingSeconds -= elapsed;
    if (pomodoro.remainingSeconds > 0) {
      persistSoon();
      return;
    }
    if (pomodoro.phase === "focus") {
      finishFocus();
    } else if (pomodoro.pauseBetweenCycles && !pomodoro.taskId) {
      pomodoro.phase = "idle";
      pomodoro.running = false;
      pomodoro.awaitingContinue = true;
      pomodoro.remainingSeconds = pomodoro.totalSeconds;
      stopTimer();
      persistNow();
      emitPhase();
    } else {
      startPhase("focus");
    }
    persistNow();
  }

  function snapshot() {
    return JSON.parse(JSON.stringify(state));
  }

  function reportData() {
    const history = state.history.slice();
    const pomodoro = state.pomodoro;
    if (pomodoro.running && pomodoro.phase === "focus") {
      const task = state.tasks.find((entry) => entry.id === pomodoro.taskId);
      const activeSeconds = (pomodoro.sessionFocusSeconds || 0)
        + Math.max(0, Math.floor((now() - lastTickAt) / 1000));
      const activeMinutes = Math.floor(activeSeconds / 60);
      if (activeMinutes > 0) {
        history.push({
          kind: "focus",
          at: now(),
          minutes: activeMinutes,
          points: activeMinutes,
          taskId: task ? task.id : null,
          taskTitle: task ? task.title : null,
          category: task ? task.category : null,
        });
      }
    }
    return {
      history,
      points: { ...state.points },
    };
  }

  // A running timer is resumed after a normal app restart.  The persisted
  // remaining value is intentionally the restart baseline; this avoids
  // guessing how long the machine was asleep while the app was closed.
  if (state.pomodoro.running && state.pomodoro.phase !== "idle") ensureTimer();

  const api = {
    getSnapshot: snapshot,
    getReportData: reportData,
    getReport(spec) {
      const { buildReport } = require("./study-report");
      return buildReport(reportData(), spec, now());
    },

    // Replace the local working copy with an account-scoped cloud snapshot.
    // This is used on login and logout so one desktop installation can safely
    // serve multiple accounts without leaking tasks or points between them.
    hydrate(rawState) {
      stopTimer();
      state = sanitizeState(rawState);
      lastTickAt = now();
      if (state.pomodoro.running && state.pomodoro.phase !== "idle") ensureTimer();
      persistNow();
      emitPhase();
      return snapshot();
    },

    setView(patch) {
      state.view = sanitizeView({ ...state.view, ...(patch || {}) });
      persistNow();
      return snapshot();
    },

    addTask(input) {
      const payload = input && typeof input === "object" ? input : { title: input };
      const title = cleanText(payload.title);
      if (!title) return snapshot();
      state.tasks.push({
        id: makeId(now),
        title,
        done: false,
        createdAt: now(),
        estimatedMinutes: sanitizeMinutes(payload.estimatedMinutes),
        completedPomodoros: 0,
        focusMinutes: 0,
        startedAt: null,
        deadline: sanitizeDeadline(payload.deadline),
        category: sanitizeCategory(payload.category),
        quadrant: QUADRANTS.includes(payload.quadrant) ? payload.quadrant : null,
        completedAt: null,
        subtasks: sanitizeSubtasks(payload.subtasks),
      });
      persistNow();
      return snapshot();
    },

    updateTask(id, patch) {
      const task = state.tasks.find((entry) => entry.id === id);
      if (!task || !patch || typeof patch !== "object") return snapshot();
      if (typeof patch.title === "string") {
        const title = cleanText(patch.title);
        if (title) task.title = title;
      }
      if ("estimatedMinutes" in patch) task.estimatedMinutes = sanitizeMinutes(patch.estimatedMinutes);
      if ("deadline" in patch) task.deadline = sanitizeDeadline(patch.deadline);
      if ("category" in patch) task.category = sanitizeCategory(patch.category);
      if ("quadrant" in patch) task.quadrant = QUADRANTS.includes(patch.quadrant) ? patch.quadrant : null;
      persistNow();
      return snapshot();
    },

    toggleTask(id) {
      const task = state.tasks.find((entry) => entry.id === id);
      if (task) {
        task.done = !task.done;
        if (task.done) {
          markTaskComplete(task);
          if (state.pomodoro.taskId === id) {
            stopTimer();
            resetToIdle();
            emitPhase();
          }
        }
        persistNow();
      }
      return snapshot();
    },

    removeTask(id) {
      state.tasks = state.tasks.filter((entry) => entry.id !== id);
      if (state.pomodoro.taskId === id) {
        resetToIdle();
        stopTimer();
        emitPhase();
      }
      persistNow();
      return snapshot();
    },

    addSubtask(id, input) {
      const task = state.tasks.find((entry) => entry.id === id);
      const title = cleanText(input && input.title);
      if (!task || !title) return snapshot();
      task.subtasks.push({
        id: makeId(now),
        title,
        done: false,
        estimatedMinutes: sanitizeMinutes(input && input.estimatedMinutes),
      });
      persistNow();
      return snapshot();
    },

    updateSubtask(id, subtaskId, patch) {
      const task = state.tasks.find((entry) => entry.id === id);
      const subtask = task && (task.subtasks || []).find((entry) => entry.id === subtaskId);
      if (!subtask || !patch || typeof patch !== "object") return snapshot();
      if (typeof patch.title === "string") {
        const title = cleanText(patch.title);
        if (title) subtask.title = title;
      }
      if ("estimatedMinutes" in patch) subtask.estimatedMinutes = sanitizeMinutes(patch.estimatedMinutes);
      persistNow();
      return snapshot();
    },

    toggleSubtask(id, subtaskId) {
      const task = state.tasks.find((entry) => entry.id === id);
      const subtask = task && (task.subtasks || []).find((entry) => entry.id === subtaskId);
      if (subtask) {
        subtask.done = !subtask.done;
        persistNow();
      }
      return snapshot();
    },

    removeSubtask(id, subtaskId) {
      const task = state.tasks.find((entry) => entry.id === id);
      if (task) {
        const isActiveSubtask = state.pomodoro.taskId === id
          && state.pomodoro.currentSubtaskId === subtaskId;
        task.subtasks = (task.subtasks || []).filter((entry) => entry.id !== subtaskId);
        if (state.pomodoro.taskId === id) {
          state.pomodoro.subtaskIds = state.pomodoro.subtaskIds.filter((entry) => entry !== subtaskId);
        }
        if (isActiveSubtask) {
          stopTimer();
          resetToIdle();
          emitPhase();
        }
        persistNow();
      }
      return snapshot();
    },

    setFocusMinutes(minutes) {
      const value = Number(minutes);
      if (state.pomodoro.phase !== "idle" || !FOCUS_MINUTE_OPTIONS.includes(value)) return snapshot();
      state.pomodoro.focusMinutes = value;
      state.pomodoro.totalSeconds = value * 60;
      state.pomodoro.remainingSeconds = value * 60;
      persistNow();
      return snapshot();
    },

    setShortBreakMinutes(minutes) {
      const value = Number(minutes);
      if (state.pomodoro.phase === "idle" && Number.isInteger(value) && value > 0 && value <= 60) {
        state.pomodoro.shortBreakMinutes = value;
        persistNow();
      }
      return snapshot();
    },

    setSplitLongSubtasks(split) {
      if (state.pomodoro.phase === "idle") {
        state.pomodoro.splitLongSubtasks = split === true;
        persistNow();
      }
      return snapshot();
    },

    setPauseBetweenCycles(pause) {
      state.pomodoro.pauseBetweenCycles = pause !== false;
      persistNow();
      return snapshot();
    },

    setPomodoroMode(mode) {
      if (state.pomodoro.phase === "idle" && MODES.includes(mode) && state.pomodoro.mode !== mode) {
        state.pomodoro.mode = mode;
        stopTimer();
        resetToIdle();
        persistNow();
        emitPhase();
      }
      return snapshot();
    },

    startTaskPomodoro(id) {
      const task = state.tasks.find((entry) => entry.id === id);
      if (!task || task.done || state.pomodoro.phase !== "idle") return snapshot();
      const pomodoro = state.pomodoro;
      const hasSubtasks = Array.isArray(task.subtasks) && task.subtasks.length > 0;
      const pendingSubtasks = (task.subtasks || []).filter((entry) => !entry.done);
      pomodoro.mode = "countdown";
      pomodoro.taskId = id;
      if (task.startedAt == null) task.startedAt = now();
      pomodoro.subtaskIds = pendingSubtasks.map((entry) => entry.id);
      pomodoro.currentSubtaskId = pomodoro.subtaskIds[0] || null;
      const first = pendingSubtasks[0];
      pomodoro.currentSubtaskRemainingSeconds = pomodoro.splitLongSubtasks && first
        && first.estimatedMinutes > pomodoro.focusMinutes ? first.estimatedMinutes * 60 : 0;
      if (hasSubtasks && pendingSubtasks.length === 0) {
        task.done = true;
        resetToIdle();
        persistNow();
        return snapshot();
      }
      if (!hasSubtasks) {
        const totalMinutes = task.estimatedMinutes || DEFAULT_FOCUS_MIN;
        pomodoro.subtaskIds = [];
        pomodoro.currentSubtaskId = null;
        pomodoro.currentSubtaskRemainingSeconds = 0;
        pomodoro.taskTotalSeconds = totalMinutes * 60;
        pomodoro.taskRemainingSeconds = totalMinutes * 60;
      } else if (pendingSubtasks.length === (task.subtasks || []).length) {
        const totalMinutes = effectiveMinutes(task) || DEFAULT_FOCUS_MIN;
        pomodoro.taskTotalSeconds = totalMinutes * 60;
        pomodoro.taskRemainingSeconds = totalMinutes * 60;
      } else {
        pomodoro.taskTotalSeconds = 0;
        pomodoro.taskRemainingSeconds = 0;
      }
      startPhase("focus");
      persistNow();
      return snapshot();
    },

    addSchedule(input) {
      const payload = input && typeof input === "object" ? input : {};
      const title = cleanText(payload.title);
      if (!title) return snapshot();
      const date = Number(payload.date);
      const clock = normalizeScheduleClock(payload.timeMinutes, payload.endTimeMinutes);
      state.schedules.push({
        id: makeId(now),
        title,
        date: Number.isFinite(date) && date > 0 ? Math.floor(date) : null,
        timeMinutes: clock.start,
        endTimeMinutes: clock.end,
        done: false,
        category: sanitizeCategory(payload.category),
        createdAt: now(),
      });
      persistNow();
      return snapshot();
    },

    updateSchedule(id, patch) {
      const schedule = state.schedules.find((entry) => entry.id === id);
      if (!schedule || !patch || typeof patch !== "object") return snapshot();
      if (typeof patch.title === "string") {
        const title = cleanText(patch.title);
        if (title) schedule.title = title;
      }
      if ("date" in patch) {
        const date = Number(patch.date);
        schedule.date = Number.isFinite(date) && date > 0 ? Math.floor(date) : null;
      }
      if ("timeMinutes" in patch || "endTimeMinutes" in patch) {
        const clock = normalizeScheduleClock(
          "timeMinutes" in patch ? patch.timeMinutes : schedule.timeMinutes,
          "endTimeMinutes" in patch ? patch.endTimeMinutes : schedule.endTimeMinutes,
        );
        schedule.timeMinutes = clock.start;
        schedule.endTimeMinutes = clock.end;
      }
      if ("category" in patch) schedule.category = sanitizeCategory(patch.category);
      if ("done" in patch) schedule.done = patch.done === true;
      persistNow();
      return snapshot();
    },

    toggleSchedule(id) {
      const schedule = state.schedules.find((entry) => entry.id === id);
      if (schedule) {
        schedule.done = !schedule.done;
        persistNow();
      }
      return snapshot();
    },

    removeSchedule(id) {
      state.schedules = state.schedules.filter((entry) => entry.id !== id);
      persistNow();
      return snapshot();
    },

    setDailyGoal(payload) {
      const input = payload && typeof payload === "object" ? payload : {};
      const minutes = Number(input.minutes);
      const next = Number.isInteger(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null;
      let key = null;
      if (typeof input.date === "string") {
        key = /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
      } else if (Number.isFinite(Number(input.date)) && Number(input.date) > 0) {
        key = localDayKey(Number(input.date));
      }
      const hasDate = Object.prototype.hasOwnProperty.call(input, "date");
      if (hasDate && !key) return snapshot();
      const name = cleanText(input.name, 120);
      const description = cleanText(input.description, 500);
      if (key) {
        if (next == null) {
          delete state.goals.overrides[key];
          delete state.goals.overrideNames[key];
          delete state.goals.overrideDescriptions[key];
        } else {
          state.goals.overrides[key] = next;
          state.goals.overrideNames[key] = name;
          state.goals.overrideDescriptions[key] = description;
        }
      } else {
        state.goals.defaultMinutes = next;
        state.goals.defaultName = name;
        state.goals.defaultDescription = description;
      }
      persistNow();
      return snapshot();
    },

    addDailyGoal(payload) {
      const input = payload && typeof payload === "object" ? payload : {};
      const date = typeof input.date === "string"
        ? (/^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null)
        : (Number.isFinite(Number(input.date)) && Number(input.date) > 0 ? localDayKey(Number(input.date)) : null);
      const minutes = Number(input.minutes);
      if (!date || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return snapshot();
      state.goals.items.push({
        id: makeId(now), date, name: cleanText(input.name, 120),
        description: cleanText(input.description, 500), minutes,
      });
      persistNow();
      return snapshot();
    },

    removeDailyGoal(id) {
      if (typeof id !== "string" || !id) return snapshot();
      state.goals.items = state.goals.items.filter((item) => item.id !== id);
      persistNow();
      return snapshot();
    },

    updateDailyGoal(id, patch) {
      const item = state.goals.items.find((entry) => entry.id === id);
      if (!item || !patch || typeof patch !== "object") return snapshot();
      const minutes = Number(patch.minutes);
      if (Number.isInteger(minutes) && minutes > 0 && minutes <= 1440) item.minutes = minutes;
      if (typeof patch.name === "string") item.name = cleanText(patch.name, 120);
      if (typeof patch.description === "string") item.description = cleanText(patch.description, 500);
      persistNow();
      return snapshot();
    },

    startDailyGoal(goal) {
      const input = goal && typeof goal === "object" ? goal : {};
      const id = typeof input.id === "string" && input.id ? input.id : null;
      const date = typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
      const minutes = Number(input.minutes);
      if (!id || !date || !Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) return snapshot();
      const taskId = `daily-goal:${id}`;
      let task = state.tasks.find((entry) => entry.id === taskId);
      if (!task) {
        const deadline = new Date(`${date}T23:59:59`).getTime();
        task = { id: taskId, title: cleanText(input.name, 500) || "Daily goal", done: false, createdAt: now(), estimatedMinutes: minutes, completedPomodoros: 0, deadline: Number.isFinite(deadline) ? deadline : null, category: null, quadrant: null, subtasks: [] };
        state.tasks.push(task);
      }
      const next = api.startTaskPomodoro(task.id);
      persistNow();
      return next;
    },

    pomodoroCommand(command) {
      const pomodoro = state.pomodoro;
      if (command === "start") {
        if (pomodoro.phase === "idle") {
          pomodoro.taskId = null;
          pomodoro.taskTotalSeconds = 0;
          pomodoro.taskRemainingSeconds = 0;
          pomodoro.subtaskIds = [];
          pomodoro.currentSubtaskId = null;
          pomodoro.currentSubtaskRemainingSeconds = 0;
          pomodoro.awardedFocusSeconds = 0;
          startPhase("focus");
        } else if (!pomodoro.running) {
          pomodoro.running = true;
          ensureTimer();
          persistNow();
          emitPhase();
        }
      } else if (command === "continue") {
        if (pomodoro.phase === "idle" && pomodoro.awaitingContinue) startPhase("focus");
      } else if (command === "pause") {
        if (pomodoro.running) {
          pomodoro.running = false;
          stopTimer();
          persistNow();
          emitPhase();
        }
      } else if (command === "reset") {
        stopTimer();
        resetToIdle();
        persistNow();
        emitPhase();
      } else if (command === "skip") {
        if (pomodoro.mode === "countup") {
          pomodoro.elapsedSeconds = 0;
          pomodoro.phase = "focus";
          pomodoro.running = true;
          ensureTimer();
          persistNow();
          emitPhase();
        } else if (pomodoro.phase === "idle") {
          startPhase("focus");
        } else if (pomodoro.phase === "focus") {
          finishFocus();
          persistNow();
        } else {
          startPhase("focus");
          persistNow();
        }
      }
      return snapshot();
    },

    dispose() {
      stopTimer();
      if (saveTimer) clearTimeoutFn(saveTimer);
      saveTimer = null;
      persistNow();
    },
  };
  return api;
}

module.exports = {
  createStudyRuntime,
  defaultState,
  defaultPoints,
  defaultGoals,
  sanitizePoints,
  sanitizeGoals,
  sanitizeSchedules,
  sanitizeHistory,
  sanitizeState,
  DEFAULT_FOCUS_MIN,
  DEFAULT_SHORT_BREAK_MIN,
  FOCUS_MINUTE_OPTIONS,
  MODES,
  PHASES,
  QUADRANTS,
};
