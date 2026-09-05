"use strict";

const api = window.studyAPI;
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

function t(key) {
  return (i18nPayload.translations && i18nPayload.translations[key]) || key;
}

function call(method, ...args) {
  if (!api || typeof api[method] !== "function") return Promise.resolve(snapshot);
  return api[method](...args).then((next) => {
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
  for (const group of groupedTasks(sorted, view.groupBy)) {
    if (group.label) { const heading = document.createElement("div"); heading.className = "group-title"; heading.textContent = group.label; taskList.appendChild(heading); }
    for (const task of group.items) taskList.appendChild(createTaskCard(task));
  }
}

function render() {
  titleEl.textContent = t("studyWindowTitle");
  subtitleEl.textContent = t("studyWindowSubtitle");
  timerTitleEl.textContent = t("studyPomodoroTitle");
  tasksTitleEl.textContent = t("studyTasksTitle");
  addTaskButton.textContent = t("studyAddTask");
  taskTitle.placeholder = t("studyTaskPlaceholder");
  taskCategory.placeholder = t("studyCategoryPlaceholder");
  const selectedQuadrant = taskQuadrant.value;
  taskQuadrant.replaceChildren(...quadrantOptions(selectedQuadrant || null, true));
  for (const button of modeButtons.children) button.textContent = button.dataset.mode === "countup" ? t("studyModeCountup") : t("studyModeCountdown");
  const points = snapshot.points || {};
  pointsEl.innerHTML = `<strong>${Number(points.total) || 0}</strong><span>${t("studyPoints")}</span>`;
  renderTimer();
  renderTasks();
}

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
if (api && typeof api.onSnapshot === "function") api.onSnapshot((next) => { snapshot = next || snapshot; render(); });
if (api && typeof api.onLangChange === "function") api.onLangChange((next) => { i18nPayload = next || i18nPayload; lastTaskKey = ""; lastViewKey = ""; render(); });

Promise.all([
  api && typeof api.getSnapshot === "function" ? api.getSnapshot() : Promise.resolve(snapshot),
  api && typeof api.getI18n === "function" ? api.getI18n() : Promise.resolve(i18nPayload),
]).then(([nextSnapshot, nextI18n]) => {
  snapshot = nextSnapshot || snapshot;
  i18nPayload = nextI18n || i18nPayload;
  render();
}).catch((error) => console.warn("study dashboard initialization failed:", error));
