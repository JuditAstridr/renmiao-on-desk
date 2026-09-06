"use strict";

// Keep this binding private to the Study renderer.  study-calendar.js is a
// classic script loaded before this file and also exposes a top-level `api`
// constant; redeclaring it here aborts the entire renderer with a SyntaxError.
const studyApi = window.studyAPI;
let i18nPayload = { lang: "en", translations: {} };
let snapshot = { tasks: [], pomodoro: null, view: { sortBy: "created", groupBy: "none" } };
let lastTaskKey = "";
let lastViewKey = "";

const $ = (id) => document.getElementById(id);
const titleEl = $("title");
const subtitleEl = $("subtitle");
const pointsEl = $("points");
const timerTitleEl = $("timerTitle");
const tasksTitleEl = $("tasksTitle");
const phaseEl = $("phase");
const timerValueEl = $("timerValue");
const timerTargetEl = $("timerTarget");
const progressFillEl = $("progressFill");
const timerMetaEl = $("timerMeta");
const startButton = $("startButton");
const resetButton = $("resetButton");
const skipButton = $("skipButton");
const focusButton = $("focusButton");
const modeLabel = $("modeLabel");
const modeButtons = $("modeButtons");
const focusLabel = $("focusLabel");
const focusButtons = $("focusButtons");
const breakLabel = $("breakLabel");
const breakMinutes = $("breakMinutes");
const splitLong = $("splitLong");
const splitLabel = $("splitLabel");
const continuous = $("continuous");
const continuousLabel = $("continuousLabel");
const taskForm = $("taskForm");
const taskTitle = $("taskTitle");
const taskEstimate = $("taskEstimate");
const taskDeadline = $("taskDeadline");
const taskCategory = $("taskCategory");
const taskQuadrant = $("taskQuadrant");
const addTaskButton = $("addTaskButton");
const viewControls = $("viewControls");
const taskList = $("taskList");
const studyTabs = $("studyTabs");
const timerSection = $("timerSection");
const tasksSection = $("tasksSection");
const calendarSection = $("calendarSection");
const reportSection = $("reportSection");
const calendarRange = $("calendarRange");
const calendarWeekdays = $("calendarWeekdays");
const calendarGrid = $("calendarGrid");
const calendarPanel = $("calendarPanel");
const calendarGoalLabel = $("calendarGoalLabel");
const calendarDefaultGoal = $("calendarDefaultGoal");
const reportRange = $("reportRange");
const reportStats = $("reportStats");
const reportTrend = $("reportTrend");
const reportChart = $("reportChart");
const reportFacts = $("reportFacts");
const reportBreakdown = $("reportBreakdown");
const posterPreview = $("posterPreview");
const reportSaveStatus = $("reportSaveStatus");
const pointsValue = $("pointsValue");
const pointsLevel = $("pointsLevel");
const pointsLevelFill = $("pointsLevelFill");
const pointsToday = $("pointsToday");
const pointsRules = $("pointsRules");
const pointsRulesBody = $("pointsRulesBody");
let activeTab = "tasks";
let reportSpec = { unit: "week", offset: 0 };
let reportData = null;
let calendarMode = null;
let calendarData = null;
let selectedCalendarDay = null;
let reportRequestId = 0;
let calendarRequestId = 0;
let posterPet = null;
let posterPetPromise = null;
let posterResourcesReady = false;
let posterResourcesPromise = null;
let posterDataUrl = null;
let posterLightbox = null;
let posterLightboxImage = null;
let posterLightboxZoom = 1;

const POSTER_STAT_ICONS = ["icon-focus", "icon-time", "icon-tasks", "icon-points"];
const POSTER_DECO_IDS = ["deco-tomato", "deco-tomato-slice", "deco-wedge", "deco-chip"];

function t(key) {
  return (i18nPayload.translations && i18nPayload.translations[key]) || key;
}

function label(key, fallback) {
  const value = t(key);
  return value === key ? fallback : value;
}

function levelThreshold(level) {
  return 100 * (level - 1) * level / 2;
}

function levelInfo(total) {
  const value = Math.max(0, Math.floor(Number(total) || 0));
  let level = 1;
  while (levelThreshold(level + 1) <= value) level += 1;
  const current = levelThreshold(level);
  const next = levelThreshold(level + 1);
  return {
    level,
    total: value,
    next,
    pct: next > current ? Math.max(0, Math.min(100, ((value - current) / (next - current)) * 100)) : 100,
  };
}

function renderPoints() {
  const points = snapshot.points || {};
  const info = levelInfo(points.total);
  if (pointsValue) pointsValue.textContent = String(info.total);
  if (pointsLevel) pointsLevel.textContent = `LV ${info.level} · ${info.total}/${info.next}`;
  if (pointsLevelFill) pointsLevelFill.style.width = `${info.pct}%`;
  if (pointsToday) pointsToday.textContent = label("studyPointsToday", "Today: {n}").replace("{n}", String(Number(points.today) || 0));
  if (pointsRules) pointsRules.textContent = label("studyPointsRules", "How points work");
  if (pointsRulesBody) pointsRulesBody.textContent = label("studyPointsRulesBody", "Focus earns points over time; completing tasks earns a bonus.");
}

function call(method, ...args) {
  if (!studyApi || typeof studyApi[method] !== "function") return Promise.resolve(snapshot);
  return Promise.resolve(studyApi[method](...args)).then((next) => {
    if (next && typeof next === "object") {
      snapshot = next;
      render();
    }
    return next;
  }).catch((error) => {
    console.warn(`study action ${method} failed:`, error);
    return snapshot;
  });
}

function formatTimer(seconds, countup = false) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(value / 3600);
  const minutes = String(Math.floor((value % 3600) / 60)).padStart(2, "0");
  const secs = String(value % 60).padStart(2, "0");
  const body = hours > 0 ? `${hours}:${minutes}:${secs}` : `${minutes}:${secs}`;
  return countup ? `+${body}` : body;
}

function formatMinutes(value) {
  const minutes = Number(value) || 0;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function dateToEpoch(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T23:59:59`);
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : null;
}

function epochToDate(value) {
  if (!Number.isFinite(value)) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function deadlineLabel(value) {
  if (!Number.isFinite(value)) return "";
  const days = Math.ceil((new Date(value).setHours(0, 0, 0, 0) - todayStart()) / 86400000);
  if (days < 0) return t("studyDeadlineOverdue");
  return days === 0 ? t("studyDeadlineToday") : t("studyDeadlineDays").replace("{n}", days);
}

function taskMinutes(task) {
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const total = subtasks.reduce((sum, subtask) => sum + (subtask.estimatedMinutes || 0), 0);
  return total > 0 ? total : task.estimatedMinutes;
}

function taskKey(tasks) {
  return JSON.stringify((tasks || []).map((task) => [
    task.id, task.title, task.done, task.estimatedMinutes, task.deadline, task.category, task.quadrant,
    (task.subtasks || []).map((subtask) => [subtask.id, subtask.title, subtask.done, subtask.estimatedMinutes]),
  ]));
}

function sortTasks(tasks, sortBy) {
  const sorted = tasks.slice();
  const estimate = (task) => taskMinutes(task) || Number.MAX_SAFE_INTEGER;
  sorted.sort((a, b) => {
    if (sortBy === "deadline") return (a.deadline || Number.MAX_SAFE_INTEGER) - (b.deadline || Number.MAX_SAFE_INTEGER);
    if (sortBy === "estimate") return estimate(a) - estimate(b);
    if (sortBy === "estimateDesc") return estimate(b) - estimate(a);
    if (sortBy === "quadrant") return (a.quadrant == null ? 4 : a.quadrant) - (b.quadrant == null ? 4 : b.quadrant);
    return (b.createdAt || 0) - (a.createdAt || 0);
  });
  return sorted.filter((task) => !task.done).concat(sorted.filter((task) => task.done));
}

function groupName(groupBy, key) {
  if (groupBy === "category") return key || t("studyUncategorized");
  if (groupBy === "quadrant") {
    return t(["studyQuadrantUrgentImportant", "studyQuadrantUrgentNotImportant", "studyQuadrantNotUrgentImportant", "studyQuadrantNotUrgentNotImportant"][key] || "studyUnprioritized");
  }
  return "";
}

function groupedTasks(tasks, groupBy) {
  if (groupBy === "none") return [{ key: null, label: "", items: tasks }];
  const map = new Map();
  for (const task of tasks) {
    const key = groupBy === "category" ? (task.category || null) : (task.quadrant == null ? 3 : task.quadrant);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(task);
  }
  const keys = [...map.keys()];
  if (groupBy === "category") keys.sort((a, b) => String(a || "").localeCompare(String(b || "")));
  else keys.sort((a, b) => a - b);
  return keys.map((key) => ({ key, label: groupName(groupBy, key), items: map.get(key) }));
}

function quadrantOptions(selected, includeEmpty = false) {
  const values = includeEmpty ? [["", t("studyNoPriority")]] : [];
  values.push(
    ["0", t("studyQuadrantUrgentImportant")],
    ["1", t("studyQuadrantUrgentNotImportant")],
    ["2", t("studyQuadrantNotUrgentImportant")],
    ["3", t("studyQuadrantNotUrgentNotImportant")],
  );
  return values.map(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (String(selected == null ? "" : selected) === value) option.selected = true;
    return option;
  });
}

function createInput(type, value, className, placeholder = "") {
  const input = document.createElement("input");
  input.type = type;
  input.value = value == null ? "" : String(value);
  input.className = className || "";
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function renderTimer() {
  const pomodoro = snapshot.pomodoro || {};
  const phase = pomodoro.phase || "idle";
  const countup = pomodoro.mode === "countup";
  phaseEl.textContent = t({ focus: "studyPhaseFocus", shortBreak: "studyPhaseShortBreak", longBreak: "studyPhaseLongBreak" }[phase] || "studyPhaseIdle");
  phaseEl.className = `phase${phase === "focus" ? " focus" : (phase === "shortBreak" || phase === "longBreak" ? " break" : "")}`;
  timerValueEl.textContent = formatTimer(countup ? pomodoro.elapsedSeconds : pomodoro.remainingSeconds, countup);
  const task = pomodoro.taskId && (snapshot.tasks || []).find((entry) => entry.id === pomodoro.taskId);
  const subtask = task && pomodoro.currentSubtaskId
    ? (task.subtasks || []).find((entry) => entry.id === pomodoro.currentSubtaskId) : null;
  timerTargetEl.textContent = task
    ? `${t("studyFocusingOn").replace("{task}", task.title)}${subtask ? ` · ${subtask.title}` : ""}`
    : "";
  if (countup || !pomodoro.totalSeconds) progressFillEl.style.width = "0%";
  else progressFillEl.style.width = `${Math.max(0, Math.min(100, (1 - pomodoro.remainingSeconds / pomodoro.totalSeconds) * 100))}%`;
  const completed = pomodoro.completedFocusCycles || 0;
  const total = pomodoro.totalFocusCycles || 0;
  timerMetaEl.textContent = `${t("studyCycleHint").replace("{n}", completed)} · ${t("studyTotalFocusCycles").replace("{n}", total)}`;
  startButton.textContent = pomodoro.awaitingContinue ? t("studyContinueNext") : (pomodoro.running ? t("studyPause") : t("studyStart"));
  startButton.classList.toggle("primary", !pomodoro.awaitingContinue);
  resetButton.textContent = t("studyReset");
  skipButton.textContent = t("studySkip");
  skipButton.hidden = countup;
  focusButton.textContent = document.body.classList.contains("focus-mode") ? t("studyExitFocus") : t("studyFocusMode");
  modeLabel.textContent = t("studyTimerMode");
  focusLabel.textContent = t("studyFocusLength");
  breakLabel.textContent = t("studyShortBreakLabel");
  splitLabel.textContent = t("studyLongSubtasks");
  continuousLabel.textContent = t("studyPauseBetweenCycles");
  if (document.activeElement !== breakMinutes) breakMinutes.value = pomodoro.shortBreakMinutes || 5;
  splitLong.checked = pomodoro.splitLongSubtasks === true;
  continuous.checked = pomodoro.pauseBetweenCycles === false;

  const locked = phase !== "idle";
  for (const element of [...modeButtons.children, ...focusButtons.children, breakMinutes, splitLong, continuous]) element.disabled = locked;
  for (const button of modeButtons.children) button.classList.toggle("active", button.dataset.mode === (countup ? "countup" : "countdown"));
  for (const button of focusButtons.children) button.classList.toggle("active", Number(button.dataset.minutes) === Number(pomodoro.focusMinutes));
}

function buildTimerControls() {
  for (const mode of ["countdown", "countup"]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.mode = mode;
    button.addEventListener("click", () => call("setPomodoroMode", mode));
    modeButtons.appendChild(button);
  }
  for (const minutes of [15, 25, 30, 45]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.minutes = String(minutes);
    button.textContent = `${minutes}m`;
    button.addEventListener("click", () => call("setFocusMinutes", minutes));
    focusButtons.appendChild(button);
  }
  breakMinutes.addEventListener("change", () => call("setShortBreakMinutes", Number(breakMinutes.value)));
  splitLong.addEventListener("change", () => call("setSplitLongSubtasks", splitLong.checked));
  continuous.addEventListener("change", () => call("setPauseBetweenCycles", !continuous.checked));
  startButton.addEventListener("click", () => {
    const command = snapshot.pomodoro && snapshot.pomodoro.awaitingContinue
      ? "continue" : (snapshot.pomodoro && snapshot.pomodoro.running ? "pause" : "start");
    call("pomodoroCommand", command);
  });
  resetButton.addEventListener("click", () => call("pomodoroCommand", "reset"));
  skipButton.addEventListener("click", () => call("pomodoroCommand", "skip"));
  focusButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      // Fullscreen can be unavailable in a test harness or under a window
      // manager; the CSS focus view remains useful as a fallback.
      document.body.classList.toggle("focus-mode");
      console.warn("study fullscreen unavailable:", error && error.message);
    }
    renderTimer();
  });
  document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("focus-mode", !!document.fullscreenElement);
    renderTimer();
  });
}

function renderViewControls() {
  const view = snapshot.view || {};
  const key = `${view.sortBy}|${view.groupBy}`;
  if (key === lastViewKey && viewControls.childElementCount) return;
  lastViewKey = key;
  viewControls.replaceChildren();
  const tabs = document.createElement("div");
  tabs.className = "view-tabs";
  for (const [value, labelKey] of [["none", "studyTabAll"], ["quadrant", "studyTabQuadrant"], ["category", "studyTabCategory"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t(labelKey);
    button.className = view.groupBy === value ? "active" : "";
    button.addEventListener("click", () => call("setView", { groupBy: value }));
    tabs.appendChild(button);
  }
  const sortLabel = document.createElement("label");
  sortLabel.className = "sort-label";
  sortLabel.appendChild(document.createTextNode(`${t("studySortBy")}:`));
  const select = document.createElement("select");
  for (const [value, labelKey] of [["created", "studySortCreated"], ["deadline", "studySortDeadline"], ["estimate", "studySortEstimateAsc"], ["estimateDesc", "studySortEstimateDesc"], ["quadrant", "studySortPriority"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(labelKey);
    option.selected = view.sortBy === value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => call("setView", { sortBy: select.value }));
  sortLabel.appendChild(select);
  viewControls.append(t("studyGroupHint"), tabs, sortLabel);
}

function appendTaskFields(card, task) {
  const fields = document.createElement("div");
  fields.className = "task-fields";
  const estimate = createInput("number", task.estimatedMinutes, "", "min");
  estimate.min = "1"; estimate.max = "600"; estimate.title = t("studyTaskEstimate");
  estimate.addEventListener("change", () => call("updateTask", task.id, { estimatedMinutes: estimate.value ? Number(estimate.value) : null }));
  fields.appendChild(estimate);
  const deadline = createInput("date", epochToDate(task.deadline), "");
  deadline.title = t("studyDeadline");
  deadline.addEventListener("change", () => call("updateTask", task.id, { deadline: dateToEpoch(deadline.value) }));
  fields.appendChild(deadline);
  const category = createInput("text", task.category, "", t("studyCategoryPlaceholder"));
  category.maxLength = 80;
  category.addEventListener("change", () => call("updateTask", task.id, { category: category.value }));
  fields.appendChild(category);
  const quadrant = document.createElement("select");
  quadrant.title = t("studyQuadrant");
  quadrant.append(...quadrantOptions(task.quadrant, true));
  quadrant.addEventListener("change", () => call("updateTask", task.id, { quadrant: quadrant.value === "" ? null : Number(quadrant.value) }));
  fields.appendChild(quadrant);
  card.appendChild(fields);
}

function appendSubtasks(card, task) {
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  const wrap = document.createElement("div");
  wrap.className = "subtasks";
  for (const subtask of subtasks) {
    const row = document.createElement("div");
    row.className = "subtask-row";
    const check = document.createElement("input");
    check.type = "checkbox"; check.checked = subtask.done; check.title = t("studyToggleSubtask");
    check.addEventListener("change", () => call("toggleSubtask", task.id, subtask.id));
    row.appendChild(check);
    const title = createInput("text", subtask.title, subtask.done ? "done" : "");
    title.maxLength = 500;
    title.addEventListener("change", () => call("updateSubtask", task.id, subtask.id, { title: title.value }));
    row.appendChild(title);
    const estimate = createInput("number", subtask.estimatedMinutes, "", "min");
    estimate.min = "1"; estimate.max = "600";
    estimate.addEventListener("change", () => call("updateSubtask", task.id, subtask.id, { estimatedMinutes: estimate.value ? Number(estimate.value) : null }));
    row.appendChild(estimate);
    const remove = document.createElement("button");
    remove.type = "button"; remove.textContent = "×"; remove.title = t("studyRemoveSubtask");
    remove.addEventListener("click", () => call("removeSubtask", task.id, subtask.id));
    row.appendChild(remove);
    wrap.appendChild(row);
  }
  const form = document.createElement("form");
  form.className = "subtask-form";
  const title = createInput("text", "", "", t("studySubtaskPlaceholder"));
  const estimate = createInput("number", "", "", "min"); estimate.min = "1"; estimate.max = "600";
  const add = document.createElement("button"); add.type = "submit"; add.textContent = t("studyAddSubtask");
  form.append(title, estimate, add);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!title.value.trim()) return;
    call("addSubtask", task.id, { title: title.value, estimatedMinutes: estimate.value ? Number(estimate.value) : null });
  });
  wrap.appendChild(form);
  card.appendChild(wrap);
}

function createTaskCard(task) {
  const card = document.createElement("article");
  card.className = `task-card${task.done ? " done" : ""}`;
  const head = document.createElement("div"); head.className = "task-head";
  const check = document.createElement("input"); check.type = "checkbox"; check.className = "task-check"; check.checked = task.done; check.title = t("studyToggleTask");
  check.addEventListener("change", () => call("toggleTask", task.id));
  head.appendChild(check);
  const title = createInput("text", task.title, `task-title${task.done ? " done" : ""}`);
  title.maxLength = 500;
  title.addEventListener("change", () => call("updateTask", task.id, { title: title.value }));
  head.appendChild(title);
  const badges = document.createElement("div"); badges.className = "task-badges";
  if (taskMinutes(task)) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = formatMinutes(taskMinutes(task)); badges.appendChild(badge); }
  if (task.deadline) { const badge = document.createElement("span"); badge.className = `badge${deadlineLabel(task.deadline) === t("studyDeadlineOverdue") ? " overdue" : ""}`; badge.textContent = deadlineLabel(task.deadline); badges.appendChild(badge); }
  if (task.category) { const badge = document.createElement("span"); badge.className = "badge"; badge.textContent = task.category; badges.appendChild(badge); }
  head.appendChild(badges);
  card.appendChild(head);
  appendTaskFields(card, task);
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
  if (subtasks.length) {
    const done = subtasks.filter((entry) => entry.done).length;
    const label = document.createElement("div"); label.className = "task-progress-label"; label.textContent = `${t("studySubtasks")}: ${done}/${subtasks.length}`; card.appendChild(label);
    const progress = document.createElement("div"); progress.className = "task-progress";
    const fill = document.createElement("div"); fill.className = "task-progress-fill"; fill.style.width = `${(done / subtasks.length) * 100}%`; progress.appendChild(fill); card.appendChild(progress);
  }
  appendSubtasks(card, task);
  const actions = document.createElement("div"); actions.className = "task-actions";
  const focus = document.createElement("button"); focus.type = "button"; focus.textContent = t("studyStartFocus");
  const active = snapshot.pomodoro && snapshot.pomodoro.phase !== "idle";
  focus.disabled = task.done || (active && snapshot.pomodoro.taskId !== task.id);
  focus.addEventListener("click", () => call("startTaskPomodoro", task.id));
  actions.appendChild(focus);
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "×"; remove.title = t("studyRemoveTask");
  remove.addEventListener("click", () => call("removeTask", task.id));
  actions.appendChild(remove);
  card.appendChild(actions);
  return card;
}

function renderTasks() {
  const tasks = snapshot.tasks || [];
  const view = snapshot.view || { sortBy: "created", groupBy: "none" };
  renderViewControls();
  const pomodoro = snapshot.pomodoro || {};
  const timerKey = `${pomodoro.phase || "idle"}|${pomodoro.taskId || ""}|${pomodoro.running === true}`;
  const key = `${taskKey(tasks)}|${view.sortBy}|${view.groupBy}|${timerKey}`;
  if (key === lastTaskKey) return;
  lastTaskKey = key;
  taskList.replaceChildren();
  const sorted = sortTasks(tasks, view.sortBy);
  if (!sorted.length) {
    const empty = document.createElement("div"); empty.className = "empty"; empty.textContent = t("studyNoTasks"); taskList.appendChild(empty); return;
  }
  if (view.groupBy === "quadrant") {
    renderQuadrantMatrix(sorted);
    return;
  }
  for (const group of groupedTasks(sorted, view.groupBy)) {
    if (group.label) { const heading = document.createElement("div"); heading.className = "group-title"; heading.textContent = group.label; taskList.appendChild(heading); }
    for (const task of group.items) taskList.appendChild(createTaskCard(task));
  }
}

// Eisenhower matrix: keep all four cells visible so moving a task between
// quadrants never changes the surrounding layout. Tasks without an explicit
// priority live in the fourth cell, matching the existing grouping behavior.
function renderQuadrantMatrix(tasks) {
  const matrix = document.createElement("div");
  matrix.className = "quadrant-grid";
  for (let quadrant = 0; quadrant < 4; quadrant += 1) {
    const cell = document.createElement("section");
    cell.className = `quadrant-cell q${quadrant}`;
    const heading = document.createElement("h3");
    heading.className = "quadrant-cell-title";
    heading.textContent = groupName("quadrant", quadrant);
    cell.appendChild(heading);
    const items = tasks.filter((task) => (task.quadrant == null ? 3 : task.quadrant) === quadrant);
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "quadrant-cell-empty";
      empty.textContent = "–";
      cell.appendChild(empty);
    } else {
      for (const task of items) cell.appendChild(createTaskCard(task));
    }
    matrix.appendChild(cell);
  }
  taskList.appendChild(matrix);
}

function renderStudyTabs() {
  for (const button of studyTabs.querySelectorAll("[data-tab]")) {
    const tab = button.dataset.tab;
    button.classList.toggle("active", tab === activeTab);
    button.textContent = tab === "tasks"
      ? label("studyTabTasks", t("studyTasksTitle"))
      : (tab === "calendar" ? label("studyTabCalendar", "Calendar") : label("studyTabReport", "Reports"));
  }
}

function localDateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dateRangeLabel(range) {
  const from = new Date(range.from).toLocaleDateString(i18nPayload.lang || undefined, { year: "numeric", month: "short", day: "numeric" });
  const to = new Date(range.to).toLocaleDateString(i18nPayload.lang || undefined, { year: "numeric", month: "short", day: "numeric" });
  return `${from} – ${to}`;
}

function reportDuration(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  if (value >= 60) return `${Math.floor(value / 60)}h ${value % 60}m`;
  return `${value}m`;
}

function reportSignature() {
  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  const last = history[history.length - 1];
  return `${reportSpec.unit}:${reportSpec.offset}:${history.length}:${last ? last.at : 0}:${snapshot.points && snapshot.points.total}`;
}

function renderReportStats(data) {
  reportStats.replaceChildren();
  const entries = [
    [data.totals.focusCount, label("studyReportFocusCount", "Focus sessions")],
    [reportDuration(data.totals.focusMinutes), label("studyReportFocusTime", "Focus time")],
    [data.totals.taskCount, label("studyReportTasksDone", "Tasks completed")],
    [data.totals.points, label("studyReportPointsEarned", "Points earned")],
  ];
  for (const [value, name] of entries) {
    const card = document.createElement("div"); card.className = "report-stat";
    const strong = document.createElement("strong"); strong.textContent = String(value);
    const span = document.createElement("span"); span.textContent = name;
    card.append(strong, span); reportStats.appendChild(card);
  }
}

function renderReport(data) {
  reportRange.textContent = dateRangeLabel(data.range);
  $("reportWeek").classList.toggle("active", data.unit === "week");
  $("reportMonth").classList.toggle("active", data.unit === "month");
  $("reportNext").disabled = data.offset >= 0;
  renderReportStats(data);

  reportTrend.replaceChildren();
  const trendTitle = document.createElement("div"); trendTitle.className = "report-card-title";
  trendTitle.textContent = label("studyReportTrendTitle", "Trend");
  const trendText = document.createElement("div"); trendText.className = "report-muted";
  const trend = data.trend || {};
  trendText.textContent = trend.growthPct == null
    ? `${trend.activeCount || 0} ${label("studyReportActivePeriods", "active periods")}`
    : `${trend.growthPct >= 0 ? "+" : ""}${trend.growthPct}% ${label("studyReportComparedWithStart", "compared with the first active period")}`;
  reportTrend.append(trendTitle, trendText);

  reportChart.replaceChildren();
  const chartTitle = document.createElement("div"); chartTitle.className = "report-card-title";
  chartTitle.textContent = label("studyReportDailyTitle", "Focus by day");
  const bars = document.createElement("div"); bars.className = "report-bars";
  const max = Math.max(1, ...data.daily.map((entry) => Number(entry.focusMinutes) || 0));
  for (const entry of data.daily) {
    const col = document.createElement("div"); col.className = "report-bar-col";
    const bar = document.createElement("div"); bar.className = "report-bar";
    bar.style.height = `${Math.max(2, Math.round(((entry.focusMinutes || 0) / max) * 100))}%`;
    bar.title = `${reportDuration(entry.focusMinutes)} · ${new Date(entry.day).toLocaleDateString()}`;
    const day = document.createElement("span"); day.className = "report-bar-label";
    day.textContent = `${new Date(entry.day).getMonth() + 1}/${new Date(entry.day).getDate()}`;
    col.append(bar, day); bars.appendChild(col);
  }
  reportChart.append(chartTitle, bars);

  reportFacts.replaceChildren();
  const factsTitle = document.createElement("div"); factsTitle.className = "report-card-title";
  factsTitle.textContent = label("studyReportFactsTitle", "Highlights");
  const list = document.createElement("ul"); list.className = "report-facts";
  const facts = [];
  if (data.facts && data.facts.story) facts.push(`${data.facts.story.taskTitle}: ${reportDuration(data.facts.story.focusMinutes)} focused over ${data.facts.story.days} day(s)`);
  if (data.facts && data.facts.bestDay) facts.push(`Best day: ${new Date(data.facts.bestDay.day).toLocaleDateString()} · ${reportDuration(data.facts.bestDay.focusMinutes)}`);
  if (data.categories && data.categories[0]) facts.push(`Top category: ${data.categories[0].category || label("studyUncategorized", "Uncategorized")} · ${reportDuration(data.categories[0].minutes)}`);
  if (data.facts && data.facts.avgTaskMinutes != null) facts.push(`Average completed-task time: ${reportDuration(data.facts.avgTaskMinutes)}`);
  if (!facts.length) facts.push(label("studyReportNoData", "No completed focus sessions yet."));
  for (const fact of facts.slice(0, 5)) { const item = document.createElement("li"); item.textContent = fact; list.appendChild(item); }
  reportFacts.append(factsTitle, list);

  reportBreakdown.replaceChildren();
  const breakdownTitle = document.createElement("div");
  breakdownTitle.className = "report-card-title";
  breakdownTitle.textContent = label("studyReportBreakdownTitle", "Breakdown");
  const breakdownGrid = document.createElement("div");
  breakdownGrid.className = "report-breakdown-grid";
  const categoryRows = (data.categories || []).slice(0, 5).map((entry) =>
    `${entry.category || label("studyUncategorized", "Uncategorized")} · ${reportDuration(entry.minutes)}`
  );
  const priorityRows = Object.entries(data.quadrantCounts || {})
    .filter(([, count]) => Number(count) > 0)
    .map(([quadrant, count]) => `${label(["studyQuadrantUrgentImportant", "studyQuadrantUrgentNotImportant", "studyQuadrantNotUrgentImportant", "studyQuadrantNotUrgentNotImportant"][Number(quadrant)] || "studyUnprioritized", "No priority")} · ${count}`);
  const longTerm = data.longTerm && data.longTerm.spanWeeks
    ? `${data.longTerm.spanWeeks} ${label("studyReportWeeksTracked", "weeks tracked")} · ${label(data.longTerm.improving ? "studyReportImproving" : "studyReportSteady", data.longTerm.improving ? "improving" : "steady")}`
    : label("studyReportNoData", "No completed focus sessions yet.");
  for (const [title, rows] of [
    [label("studyReportCategories", "Categories"), categoryRows],
    [label("studyReportPriority", "Priority"), priorityRows],
    [label("studyReportLongTerm", "Long-term"), [longTerm]],
  ]) {
    const group = document.createElement("div");
    const heading = document.createElement("strong"); heading.textContent = title; group.appendChild(heading);
    const listEl = document.createElement("div"); listEl.className = "report-breakdown-list";
    for (const row of (rows.length ? rows : [label("studyReportNoBreakdown", "No data")])) {
      const item = document.createElement("span"); item.textContent = row; listEl.appendChild(item);
    }
    group.appendChild(listEl); breakdownGrid.appendChild(group);
  }
  reportBreakdown.append(breakdownTitle, breakdownGrid);
  drawPoster(data);
}

function ensurePosterResources() {
  if (posterResourcesReady) return Promise.resolve(true);
  if (posterResourcesPromise) return posterResourcesPromise;
  posterResourcesPromise = (async () => {
    try {
      const ids = POSTER_STAT_ICONS.concat(POSTER_DECO_IDS);
      if (studyApi && typeof studyApi.getPosterAssets === "function") {
        const assets = await studyApi.getPosterAssets(ids);
        await Promise.all(Object.entries(assets || {}).map(([id, src]) => new Promise((resolve) => {
          const image = new Image();
          image.onload = () => { posterResources[id] = image; resolve(); };
          image.onerror = () => resolve();
          image.src = src;
        })));
      }
      if (studyApi && typeof studyApi.getPosterFont === "function" && typeof FontFace === "function") {
        const font = await studyApi.getPosterFont();
        if (font && font.base64) {
          const bytes = Uint8Array.from(atob(font.base64), (char) => char.charCodeAt(0));
          const face = await new FontFace("YEFONTXiaoShiTou", bytes.buffer).load().catch(() => null);
          if (face && document.fonts) document.fonts.add(face);
        }
      }
    } catch (error) {
      console.warn("study poster resources failed:", error);
    }
    posterResourcesReady = true;
    return true;
  })();
  return posterResourcesPromise;
}

const posterResources = {};

function ensurePosterPet(force = false) {
  if (force) posterPetPromise = null;
  if (posterPetPromise) return posterPetPromise;
  if (!studyApi || typeof studyApi.getPosterActivePet !== "function") return Promise.resolve(null);
  posterPetPromise = studyApi.getPosterActivePet()
    .then((pet) => { posterPet = pet || null; return posterPet; })
    .catch((error) => {
      posterPet = null;
      console.warn("study poster pet failed:", error);
      return null;
    });
  return posterPetPromise;
}

function posterPetFrame(pet, data) {
  if (!pet || !pet.frames) return null;
  const growth = data && data.trend ? Number(data.trend.growthPct) : 0;
  const mood = growth > 0 ? "happy" : (growth < 0 ? "tired" : "thinking");
  return pet.frames[mood] || pet.frames.idle || null;
}

function posterModel(data) {
  const facts = [];
  if (data.facts && data.facts.story) facts.push(`${data.facts.story.taskTitle} · ${reportDuration(data.facts.story.focusMinutes)}`);
  if (data.facts && data.facts.bestDay) facts.push(`Best day: ${new Date(data.facts.bestDay.day).toLocaleDateString()}`);
  if (data.categories && data.categories[0]) facts.push(`Top category: ${data.categories[0].category || label("studyUncategorized", "Uncategorized")}`);
  const hasData = Number(data.totals.focusCount) > 0 || Number(data.totals.taskCount) > 0;
  return {
    brand: "Renmi",
    title: label("studyReportSectionTitle", "Study report"),
    range: dateRangeLabel(data.range),
    stats: hasData ? [
      { value: data.totals.focusCount, label: label("studyReportFocusCount", "Focus sessions") },
      { value: reportDuration(data.totals.focusMinutes), label: label("studyReportFocusTime", "Focus time") },
      { value: data.totals.taskCount, label: label("studyReportTasksDone", "Tasks completed") },
      { value: data.totals.points, label: label("studyReportPointsEarned", "Points earned"), cls: "accent" },
    ] : [],
    chartTitle: label("studyReportDailyTitle", "Focus by day"),
    daily: (data.daily || []).map((entry) => ({ day: entry.day, minutes: entry.focusMinutes })),
    factsTitle: label("studyReportFactsTitle", "Highlights"),
    facts,
    noData: label("studyReportNoData", "No completed focus sessions yet."),
    footer: `LV · ${data.allTime.total} ${label("studyPoints", "points")}`,
    petSvg: posterPetFrame(posterPet, data),
    petTint: posterPet && posterPet.tint || "",
    petAccessory: posterPet && posterPet.accessory || null,
    caption: posterPet ? label("studyPosterCaption", "Keep going with Renmi!") : "",
    statIcons: hasData ? POSTER_STAT_ICONS.map((id) => posterResources[id] || null) : [],
    decoChart: posterResources["deco-tomato"] || null,
    decoFacts: posterResources["deco-tomato-slice"] || null,
    decoBg: POSTER_DECO_IDS.map((id) => posterResources[id] || null).filter(Boolean),
    highlightIndex: hasData ? 3 : null,
  };
}

function applyPosterLightboxZoom() {
  if (!posterLightboxImage || !window.ClawdReportPoster) return;
  posterLightboxImage.style.width = `${Math.round(window.ClawdReportPoster.W * posterLightboxZoom)}px`;
}

function openPosterLightbox() {
  if (!posterDataUrl) return;
  if (!posterLightbox) {
    posterLightbox = document.createElement("div");
    posterLightbox.className = "poster-lightbox";
    const toolbar = document.createElement("div");
    toolbar.className = "poster-lightbox-toolbar";
    const zoomOut = document.createElement("button"); zoomOut.type = "button"; zoomOut.textContent = "−";
    zoomOut.addEventListener("click", () => { posterLightboxZoom = Math.max(.1, posterLightboxZoom / 1.25); applyPosterLightboxZoom(); });
    const zoomIn = document.createElement("button"); zoomIn.type = "button"; zoomIn.textContent = "+";
    zoomIn.addEventListener("click", () => { posterLightboxZoom = Math.min(8, posterLightboxZoom * 1.25); applyPosterLightboxZoom(); });
    const close = document.createElement("button"); close.type = "button"; close.className = "primary"; close.textContent = "×";
    close.addEventListener("click", () => posterLightbox.classList.remove("open"));
    toolbar.append(zoomOut, zoomIn, close);
    const stage = document.createElement("div"); stage.className = "poster-lightbox-stage";
    posterLightboxImage = document.createElement("img");
    posterLightboxImage.alt = label("studyReportSectionTitle", "Study report");
    posterLightboxImage.addEventListener("wheel", (event) => {
      event.preventDefault();
      posterLightboxZoom = Math.min(8, Math.max(.1, posterLightboxZoom * (event.deltaY < 0 ? 1.15 : .87)));
      applyPosterLightboxZoom();
    }, { passive: false });
    stage.appendChild(posterLightboxImage);
    posterLightbox.append(toolbar, stage);
    document.body.appendChild(posterLightbox);
  }
  posterLightboxImage.src = posterDataUrl;
  posterLightboxZoom = Math.min(1, (window.innerHeight - 150) / (window.ClawdReportPoster ? window.ClawdReportPoster.H : 1620));
  posterLightbox.classList.add("open");
  applyPosterLightboxZoom();
}

async function drawPoster(data) {
  if (!window.ClawdReportPoster) return;
  await ensurePosterResources();
  // Refresh on each newly fetched report so a theme switch or newly unlocked
  // Renmi accessory is reflected without adding another UI picker.
  await ensurePosterPet(true);
  let canvas = posterPreview.querySelector("canvas");
  if (!canvas) {
    canvas = document.createElement("canvas");
    posterPreview.replaceChildren(canvas);
    canvas.title = label("studyPosterPreview", "Click to enlarge");
    canvas.addEventListener("click", openPosterLightbox);
  }
  try {
    await window.ClawdReportPoster.draw(canvas, posterModel(data));
    posterDataUrl = canvas.toDataURL("image/png");
    if (posterLightbox && posterLightbox.classList.contains("open")) {
      posterLightboxImage.src = posterDataUrl;
      applyPosterLightboxZoom();
    }
  } catch (error) {
    posterDataUrl = null;
    console.warn("study poster render failed:", error);
  }
}

async function refreshReport(force = false) {
  const key = reportSignature();
  if (!force && reportData && reportData._key === key) return;
  const requestId = ++reportRequestId;
  const next = await studyApi.getReport(reportSpec).catch((error) => { console.warn("study report failed:", error); return null; });
  if (requestId !== reportRequestId) return;
  if (!next || activeTab !== "report") return;
  next._key = key;
  reportData = next;
  renderReport(next);
}

function calendarOffset() {
  const now = new Date();
  return (calendarMode.year - now.getFullYear()) * 12 + calendarMode.month - (now.getMonth() + 1);
}

function ensureCalendarMode() {
  if (!calendarMode) { const now = new Date(); calendarMode = { year: now.getFullYear(), month: now.getMonth() + 1 }; }
}

function calendarHistoryKey() {
  const history = Array.isArray(snapshot.history) ? snapshot.history : [];
  const last = history[history.length - 1];
  return `${history.length}:${last ? last.at : 0}`;
}

function clockLabel(minutes) {
  if (minutes == null) return "";
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function timeMinutes(value) {
  if (!value) return null;
  const parts = value.split(":").map(Number);
  return parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) ? parts[0] * 60 + parts[1] : null;
}

function renderCalendar(data) {
  ensureCalendarMode();
  const grid = window.ClawdStudyCalendar.buildMonthGrid({
    ...calendarMode, daily: data ? data.daily : [], tasks: snapshot.tasks || [], schedules: snapshot.schedules || [], goals: snapshot.goals || {}, nowMs: Date.now(),
  });
  const cacheKey = data && data._key;
  if (cacheKey) grid._key = cacheKey;
  calendarData = grid;
  calendarRange.textContent = new Date(calendarMode.year, calendarMode.month - 1, 1).toLocaleDateString(i18nPayload.lang || undefined, { year: "numeric", month: "long" });
  calendarGoalLabel.textContent = label("studyCalendarGoalLabel", "Daily goal");
  calendarDefaultGoal.title = label("studyCalendarGoalPlaceholder", "Daily goal (min)");
  calendarDefaultGoal.value = snapshot.goals && snapshot.goals.defaultMinutes || "";
  calendarWeekdays.replaceChildren();
  const monday = new Date(2026, 8, 7);
  for (let index = 0; index < 7; index += 1) { const day = document.createElement("div"); day.className = "calendar-weekday"; day.textContent = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index).toLocaleDateString(i18nPayload.lang || undefined, { weekday: "short" }); calendarWeekdays.appendChild(day); }
  calendarGrid.replaceChildren();
  for (const week of grid.weeks) for (const cell of week) {
    const button = document.createElement("button"); button.type = "button"; button.className = `calendar-cell${cell.inMonth ? "" : " out"}${cell.isToday ? " today" : ""}${selectedCalendarDay === cell.date ? " selected" : ""}`;
    if (!cell.inMonth) button.disabled = true;
    const head = document.createElement("div"); head.className = "calendar-cell-head"; const num = document.createElement("span"); num.textContent = String(cell.dayNum); head.appendChild(num);
    if (cell.goalSet) { const dot = document.createElement("span"); dot.className = `calendar-goal${cell.goalMet ? " met" : ""}`; head.appendChild(dot); }
    button.appendChild(head);
    if (cell.focusCount) { const meta = document.createElement("div"); meta.className = "calendar-meta"; meta.textContent = `${cell.focusMinutes}m · ${cell.focusCount}`; button.appendChild(meta); }
    const visible = [];
    if (cell.primarySchedule) visible.push({ text: `${clockLabel(cell.primarySchedule.timeMinutes)} ${cell.primarySchedule.title}`.trim(), cls: `calendar-chip${cell.primarySchedule.done ? " done" : ""}` });
    if (cell.primaryTask) visible.push({ text: cell.primaryTask.title, cls: "calendar-chip task" });
    for (const item of visible) { const chip = document.createElement("span"); chip.className = item.cls; chip.textContent = item.text; button.appendChild(chip); }
    const more = cell.schedules.length + cell.tasks.length - visible.length;
    if (more > 0) { const item = document.createElement("span"); item.className = "calendar-more"; item.textContent = `+${more}`; button.appendChild(item); }
    if (cell.inMonth) button.addEventListener("click", () => { selectedCalendarDay = cell.date; renderCalendar(calendarData); renderCalendarPanel(cell); });
    calendarGrid.appendChild(button);
  }
  const selected = grid.weeks.flat().find((cell) => cell.inMonth && cell.date === selectedCalendarDay) || grid.weeks.flat().find((cell) => cell.inMonth);
  if (selectedCalendarDay == null && selected) { selectedCalendarDay = selected.date; renderCalendar(grid); return; }
  renderCalendarPanel(selected);
}

function renderCalendarPanel(cell) {
  if (!cell) return;
  calendarPanel.replaceChildren();
  const title = document.createElement("h3"); title.textContent = new Date(cell.date).toLocaleDateString(i18nPayload.lang || undefined, { weekday: "long", month: "long", day: "numeric" }); calendarPanel.appendChild(title);
  const summary = document.createElement("div"); summary.className = "calendar-summary"; summary.textContent = `${cell.focusMinutes}m focus · ${cell.focusCount} ${label("studyReportFocusCount", "sessions")}`; calendarPanel.appendChild(summary);
  if (cell.goalSet) {
    const goalInfo = document.createElement("div"); goalInfo.className = "calendar-goal-info";
    const goalTitle = document.createElement("strong"); goalTitle.textContent = `${cell.goalName || label("studyCalendarGoalDefaultName", "Daily goal")} · ${cell.goal}m`;
    goalInfo.appendChild(goalTitle);
    if (cell.goalDescription) { const description = document.createElement("div"); description.textContent = cell.goalDescription; goalInfo.appendChild(description); }
    calendarPanel.appendChild(goalInfo);
  }
  const goalRow = document.createElement("form"); goalRow.className = "calendar-form";
  const goalName = document.createElement("input"); goalName.type = "text"; goalName.maxLength = "120"; goalName.placeholder = label("studyCalendarGoalName", "Goal name"); goalName.value = cell.goalName || "";
  const goalDescription = document.createElement("input"); goalDescription.type = "text"; goalDescription.maxLength = "500"; goalDescription.placeholder = label("studyCalendarGoalDescription", "Description"); goalDescription.value = cell.goalDescription || "";
  const goal = document.createElement("input"); goal.type = "number"; goal.className = "calendar-goal-minutes"; goal.min = "1"; goal.max = "1440"; goal.placeholder = label("studyCalendarGoalPlaceholder", "Daily goal (min)"); goal.value = cell.goal || "";
  const setGoal = document.createElement("button"); setGoal.type = "submit"; setGoal.className = "primary"; setGoal.textContent = label("studyCalendarGoalSet", "Set goal");
  goalRow.addEventListener("submit", (event) => {
    event.preventDefault();
    call("setDailyGoal", { date: cell.date, name: goalName.value, description: goalDescription.value, minutes: goal.value ? Number(goal.value) : null });
  });
  goalRow.append(goalName, goalDescription, goal, setGoal); calendarPanel.appendChild(goalRow);
  const taskTitle = document.createElement("div"); taskTitle.className = "report-card-title"; taskTitle.textContent = label("studyCalendarTasksDue", "Tasks due"); calendarPanel.appendChild(taskTitle);
  const taskListEl = document.createElement("div"); taskListEl.className = "calendar-list";
  if (!cell.tasks.length) { const empty = document.createElement("div"); empty.className = "report-muted"; empty.textContent = label("studyCalendarNoTasksDue", "No tasks due"); taskListEl.appendChild(empty); }
  for (const task of cell.tasks) { const row = document.createElement("label"); row.className = "calendar-list-row"; const check = document.createElement("input"); check.type = "checkbox"; check.checked = task.done; check.addEventListener("change", () => call("toggleTask", task.id)); const span = document.createElement("span"); span.className = "calendar-row-title"; span.textContent = task.title; row.append(check, span); taskListEl.appendChild(row); }
  calendarPanel.appendChild(taskListEl);
  const scheduleTitle = document.createElement("div"); scheduleTitle.className = "report-card-title"; scheduleTitle.style.marginTop = "10px"; scheduleTitle.textContent = label("studyCalendarSchedules", "Schedules"); calendarPanel.appendChild(scheduleTitle);
  const schedules = document.createElement("div"); schedules.className = "calendar-list";
  for (const schedule of cell.schedules) {
    const row = document.createElement("div"); row.className = "calendar-list-row"; const check = document.createElement("input"); check.type = "checkbox"; check.checked = schedule.done; check.addEventListener("change", () => call("toggleSchedule", schedule.id));
    const input = document.createElement("input"); input.type = "text"; input.value = schedule.title; input.className = "calendar-row-title"; input.addEventListener("change", () => call("updateSchedule", schedule.id, { title: input.value }));
    const date = document.createElement("input"); date.type = "date"; date.value = epochToDate(schedule.date); date.title = label("studyCalendarDate", "Date"); date.addEventListener("change", () => call("updateSchedule", schedule.id, { date: dateToEpoch(date.value) }));
    const time = document.createElement("input"); time.type = "time"; time.value = schedule.timeMinutes == null ? "" : `${String(Math.floor(schedule.timeMinutes / 60)).padStart(2, "0")}:${String(schedule.timeMinutes % 60).padStart(2, "0")}`; time.title = label("studyCalendarStartTime", "Start time");
    const end = document.createElement("input"); end.type = "time"; end.value = schedule.endTimeMinutes == null ? "" : `${String(Math.floor(schedule.endTimeMinutes / 60)).padStart(2, "0")}:${String(schedule.endTimeMinutes % 60).padStart(2, "0")}`; end.title = label("studyCalendarEndTime", "End time");
    const updateClock = () => call("updateSchedule", schedule.id, { timeMinutes: timeMinutes(time.value), endTimeMinutes: timeMinutes(end.value) }); time.addEventListener("change", updateClock); end.addEventListener("change", updateClock);
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = label("studyRemoveSchedule", "Remove schedule"); remove.addEventListener("click", () => call("removeSchedule", schedule.id)); row.append(check, input, date, time, end, remove); schedules.appendChild(row);
  }
  if (!cell.schedules.length) { const empty = document.createElement("div"); empty.className = "report-muted"; empty.textContent = label("studyCalendarNoSchedules", "No schedules"); schedules.appendChild(empty); }
  calendarPanel.appendChild(schedules);
  const form = document.createElement("form"); form.className = "calendar-form"; const titleInput = document.createElement("input"); titleInput.type = "text"; titleInput.placeholder = label("studyCalendarAddSchedule", "Add a schedule"); const start = document.createElement("input"); start.type = "time"; const end = document.createElement("input"); end.type = "time"; const add = document.createElement("button"); add.type = "submit"; add.className = "primary"; add.textContent = label("studyAdd", "Add"); form.append(titleInput, start, end, add); form.addEventListener("submit", (event) => { event.preventDefault(); if (!titleInput.value.trim()) return; call("addSchedule", { title: titleInput.value, date: cell.date, timeMinutes: timeMinutes(start.value), endTimeMinutes: timeMinutes(end.value) }); }); calendarPanel.appendChild(form);
}

async function refreshCalendar(force = false) {
  ensureCalendarMode();
  const key = `${calendarMode.year}-${calendarMode.month}:${calendarHistoryKey()}:${JSON.stringify({
    tasks: snapshot.tasks || [], schedules: snapshot.schedules || [], goals: snapshot.goals || {},
  })}`;
  // Snapshot broadcasts arrive while the study timer is running. Rebuilding
  // the calendar panel for an unchanged month would replace the goal inputs
  // on every broadcast, stealing focus and dropping partially typed text.
  if (!force && calendarData && calendarData._key === key) return;
  const requestId = ++calendarRequestId;
  const next = await studyApi.getReport({ unit: "month", offset: calendarOffset() }).catch((error) => { console.warn("study calendar report failed:", error); return null; });
  if (requestId !== calendarRequestId) return;
  if (activeTab !== "calendar") return;
  if (next) next._key = key;
  calendarData = next;
  renderCalendar(next);
}

function selectStudyTab(tab) {
  if (!["tasks", "calendar", "report"].includes(tab)) return;
  activeTab = tab;
  renderStudyTabs();
  const tasks = tab === "tasks";
  timerSection.hidden = !tasks; tasksSection.hidden = !tasks; calendarSection.hidden = tab !== "calendar"; reportSection.hidden = tab !== "report";
  if (tab === "calendar") void refreshCalendar();
  if (tab === "report") void refreshReport();
}

function moveCalendar(delta) {
  ensureCalendarMode();
  const next = new Date(calendarMode.year, calendarMode.month - 1 + delta, 1);
  calendarMode = { year: next.getFullYear(), month: next.getMonth() + 1 };
  selectedCalendarDay = null;
  void refreshCalendar(true);
}

function moveReport(delta) {
  reportSpec = { ...reportSpec, offset: Math.min(0, reportSpec.offset + delta) };
  void refreshReport(true);
}

function render() {
  titleEl.textContent = t("studyWindowTitle");
  subtitleEl.textContent = t("studyWindowSubtitle");
  timerTitleEl.textContent = t("studyPomodoroTitle");
  tasksTitleEl.textContent = t("studyTasksTitle");
  addTaskButton.textContent = t("studyAddTask");
  renderStudyTabs();
  $("calendarToday").textContent = label("studyCalendarToday", "Today");
  $("reportWeek").textContent = label("studyReportWeek", "Week");
  $("reportMonth").textContent = label("studyReportMonth", "Month");
  $("reportSave").textContent = label("studyReportSavePoster", "Save poster");
  taskTitle.placeholder = t("studyTaskPlaceholder");
  taskCategory.placeholder = t("studyCategoryPlaceholder");
  const selectedQuadrant = taskQuadrant.value;
  taskQuadrant.replaceChildren(...quadrantOptions(selectedQuadrant || null, true));
  for (const button of modeButtons.children) button.textContent = button.dataset.mode === "countup" ? t("studyModeCountup") : t("studyModeCountdown");
  renderPoints();
  renderTimer();
  renderTasks();
  if (activeTab === "calendar") void refreshCalendar();
  if (activeTab === "report") void refreshReport();
}

studyTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-tab]");
  if (button) selectStudyTab(button.dataset.tab);
});

$("calendarPrev").addEventListener("click", () => moveCalendar(-1));
$("calendarNext").addEventListener("click", () => moveCalendar(1));
$("calendarToday").addEventListener("click", () => {
  const now = new Date();
  calendarMode = { year: now.getFullYear(), month: now.getMonth() + 1 };
  selectedCalendarDay = null;
  void refreshCalendar(true);
});
calendarDefaultGoal.addEventListener("change", () => call("setDailyGoal", {
  minutes: calendarDefaultGoal.value ? Number(calendarDefaultGoal.value) : null,
}));
$("reportWeek").addEventListener("click", () => {
  reportSpec = { unit: "week", offset: 0 };
  void refreshReport(true);
});
$("reportMonth").addEventListener("click", () => {
  reportSpec = { unit: "month", offset: 0 };
  void refreshReport(true);
});
$("reportPrev").addEventListener("click", () => moveReport(-1));
$("reportNext").addEventListener("click", () => moveReport(1));
$("reportSave").addEventListener("click", async () => {
  if (!studyApi || typeof studyApi.saveReportPoster !== "function" || !reportData) return;
  reportSaveStatus.textContent = label("studyReportSaving", "Saving…");
  try {
    if (!posterDataUrl) await drawPoster(reportData);
    if (!posterDataUrl) throw new Error("poster unavailable");
    const result = await studyApi.saveReportPoster({
      dataUrl: posterDataUrl,
      suggestedName: `renmi-study-${reportSpec.unit}-${new Date().toISOString().slice(0, 10)}.png`,
    });
    reportSaveStatus.textContent = result && result.status === "ok"
      ? label("studyReportSaved", "Saved")
      : (result && result.status === "cancel" ? label("studyReportSaveCancelled", "Cancelled") : label("studyReportSaveFailed", "Save failed"));
  } catch (error) {
    reportSaveStatus.textContent = label("studyReportSaveFailed", "Save failed");
    console.warn("study report poster save failed:", error);
  }
});

taskForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!taskTitle.value.trim()) return;
  call("addTask", {
    title: taskTitle.value,
    estimatedMinutes: taskEstimate.value ? Number(taskEstimate.value) : null,
    deadline: dateToEpoch(taskDeadline.value),
    category: taskCategory.value,
    quadrant: taskQuadrant.value === "" ? null : Number(taskQuadrant.value),
  }).then(() => {
    taskTitle.value = "";
    taskEstimate.value = "";
    taskDeadline.value = "";
    taskCategory.value = "";
    taskQuadrant.value = "";
    taskTitle.focus();
  });
});

buildTimerControls();
if (studyApi && typeof studyApi.onSnapshot === "function") studyApi.onSnapshot((next) => { snapshot = next || snapshot; render(); });
if (studyApi && typeof studyApi.onLangChange === "function") studyApi.onLangChange((next) => {
  i18nPayload = next || i18nPayload;
  lastTaskKey = "";
  lastViewKey = "";
  reportData = null;
  calendarData = null;
  render();
});

Promise.all([
  studyApi && typeof studyApi.getSnapshot === "function" ? studyApi.getSnapshot() : Promise.resolve(snapshot),
  studyApi && typeof studyApi.getI18n === "function" ? studyApi.getI18n() : Promise.resolve(i18nPayload),
]).then(([nextSnapshot, nextI18n]) => {
  snapshot = nextSnapshot || snapshot;
  i18nPayload = nextI18n || i18nPayload;
  selectStudyTab(activeTab);
  render();
}).catch((error) => console.warn("study dashboard initialization failed:", error));
