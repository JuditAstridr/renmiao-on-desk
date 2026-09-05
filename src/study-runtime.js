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

function defaultPomodoro() {
  return {
    phase: "idle",
    running: false,
    mode: "countdown",
    elapsedSeconds: 0,
    awardedFocusSeconds: 0,
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

function defaultState() {
  return {
    tasks: [],
    pomodoro: defaultPomodoro(),
    view: { sortBy: "created", groupBy: "none" },
    points: defaultPoints(),
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
      deadline: sanitizeDeadline(entry.deadline),
      category: sanitizeCategory(entry.category),
      quadrant: QUADRANTS.includes(entry.quadrant) ? entry.quadrant : null,
      subtasks: sanitizeSubtasks(entry.subtasks),
    }];
  }) : [];
  return {
    tasks,
    pomodoro: sanitizePomodoro(raw.pomodoro, tasks),
    view: sanitizeView(raw.view),
    points: sanitizePoints(raw.points),
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
  }

  function awardFocusTimePoints() {
    const pomodoro = state.pomodoro;
    const earnedMinutes = Math.floor(pomodoro.awardedFocusSeconds / 60);
    if (earnedMinutes <= 0) return;
    pomodoro.awardedFocusSeconds %= 60;
    for (let index = 0; index < earnedMinutes; index += 1) awardPoints("focusMinute");
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
    pomodoro.totalSeconds = pomodoro.focusMinutes * 60;
    pomodoro.remainingSeconds = pomodoro.totalSeconds;
  }

  function finishFocus() {
    const pomodoro = state.pomodoro;
    const taskId = pomodoro.taskId;
    const completedSeconds = pomodoro.totalSeconds;
    pomodoro.completedFocusCycles += 1;
    pomodoro.totalFocusCycles += 1;
    if (taskId) {
      const task = state.tasks.find((entry) => entry.id === taskId);
      if (task) task.completedPomodoros += 1;
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
        task.done = true;
        if (task.quadrant === 0) awardPoints("quadrant0");
        awardPoints("task");
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
        onFocusComplete({ taskId, taskFinished: true });
        return;
      }

      pomodoro.taskRemainingSeconds = Math.max(0, pomodoro.taskRemainingSeconds - completedSeconds);
      if (pomodoro.taskRemainingSeconds === 0) {
        task.done = true;
        if (task.quadrant === 0) awardPoints("quadrant0");
        awardPoints("task");
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
        onFocusComplete({ taskId, taskFinished: true });
        return;
      }
      startPhase("shortBreak");
      onFocusComplete({ taskId, taskFinished: false, intermediate: true });
      return;
    }

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
        pomodoro.awardedFocusSeconds += elapsed;
        awardFocusTimePoints();
      }
      persistSoon();
      return;
    }
    if (pomodoro.phase === "focus") {
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

  // A running timer is resumed after a normal app restart.  The persisted
  // remaining value is intentionally the restart baseline; this avoids
  // guessing how long the machine was asleep while the app was closed.
  if (state.pomodoro.running && state.pomodoro.phase !== "idle") ensureTimer();

  return {
    getSnapshot: snapshot,

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
        deadline: sanitizeDeadline(payload.deadline),
        category: sanitizeCategory(payload.category),
        quadrant: QUADRANTS.includes(payload.quadrant) ? payload.quadrant : null,
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
        if (task.done && state.pomodoro.taskId === id) {
          stopTimer();
          resetToIdle();
          emitPhase();
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
      if (state.pomodoro.phase === "idle" && FOCUS_MINUTE_OPTIONS.includes(value)) {
        state.pomodoro.focusMinutes = value;
        state.pomodoro.totalSeconds = value * 60;
        state.pomodoro.remainingSeconds = value * 60;
        persistNow();
      }
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
}

module.exports = {
  createStudyRuntime,
  defaultState,
  defaultPoints,
  sanitizePoints,
  sanitizeState,
  DEFAULT_FOCUS_MIN,
  DEFAULT_SHORT_BREAK_MIN,
  FOCUS_MINUTE_OPTIONS,
  MODES,
  PHASES,
  QUADRANTS,
};
