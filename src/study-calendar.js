"use strict";

// Pure Monday-first month layout used by the Study calendar.  Dates are kept
// as local start-of-day timestamps so task deadlines, schedules, and reports
// agree with the user's desktop timezone.

const MS_DAY = 86400000;

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function dateKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function emptyCell(date, today) {
  return {
    date,
    dayNum: new Date(date).getDate(),
    inMonth: true,
    isToday: date === today,
    focusMinutes: 0,
    focusCount: 0,
    taskCount: 0,
    points: 0,
    goal: null,
    goalName: "",
    goalDescription: "",
    goals: [],
    goalSet: false,
    goalMet: false,
    tasks: [],
    schedules: [],
    primaryTask: null,
    primarySchedule: null,
  };
}

function primaryTask(tasks) {
  return tasks.filter((task) => !task.done).sort((a, b) =>
    (a.quadrant == null ? 4 : a.quadrant) - (b.quadrant == null ? 4 : b.quadrant)
    || (a.createdAt || 0) - (b.createdAt || 0))[0] || null;
}

function buildMonthGrid(data = {}) {
  const nowMs = Number.isFinite(Number(data.nowMs)) ? Number(data.nowMs) : Date.now();
  const now = new Date(nowMs);
  const year = Number.isInteger(Number(data.year)) ? Number(data.year) : now.getFullYear();
  const month = Number.isInteger(Number(data.month)) && Number(data.month) >= 1 && Number(data.month) <= 12
    ? Number(data.month) : now.getMonth() + 1;
  const first = new Date(year, month - 1, 1).getTime();
  const last = new Date(year, month, 0).getDate();
  const lastDay = first + (last - 1) * MS_DAY;
  const today = startOfDay(nowMs);
  const leading = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daily = new Map();
  for (const entry of Array.isArray(data.daily) ? data.daily : []) {
    if (!entry || !Number.isFinite(Number(entry.day))) continue;
    daily.set(startOfDay(Number(entry.day)), entry);
  }
  const tasksByDay = new Map();
  let openTasksDue = 0;
  for (const task of Array.isArray(data.tasks) ? data.tasks : []) {
    if (!task || !Number.isFinite(Number(task.deadline))) continue;
    const day = startOfDay(Number(task.deadline));
    if (day < first || day > lastDay) continue;
    const list = tasksByDay.get(day) || [];
    list.push(task);
    tasksByDay.set(day, list);
    if (!task.done) openTasksDue += 1;
  }
  const schedulesByDay = new Map();
  let schedulesTotal = 0;
  for (const schedule of Array.isArray(data.schedules) ? data.schedules : []) {
    if (!schedule || !Number.isFinite(Number(schedule.date))) continue;
    const day = startOfDay(Number(schedule.date));
    if (day < first || day > lastDay) continue;
    const list = schedulesByDay.get(day) || [];
    list.push(schedule);
    schedulesByDay.set(day, list);
    schedulesTotal += 1;
  }
  const goals = data.goals && typeof data.goals === "object" ? data.goals : {};
  const overrides = goals.overrides && typeof goals.overrides === "object" ? goals.overrides : {};
  const defaultGoal = Number.isInteger(Number(goals.defaultMinutes)) && Number(goals.defaultMinutes) > 0
    ? Number(goals.defaultMinutes) : null;
  const defaultGoalName = typeof goals.defaultName === "string" ? goals.defaultName : "";
  const defaultGoalDescription = typeof goals.defaultDescription === "string" ? goals.defaultDescription : "";
  const goalItems = Array.isArray(goals.items) ? goals.items : [];
  const cells = [];
  for (let index = 0; index < leading; index += 1) {
    const cell = emptyCell(first - (leading - index) * MS_DAY, today);
    cell.inMonth = false;
    cells.push(cell);
  }
  let focusMinutes = 0;
  let focusCount = 0;
  let taskCount = 0;
  let points = 0;
  for (let index = 0; index < last; index += 1) {
    const date = first + index * MS_DAY;
    const cell = emptyCell(date, today);
    const focus = daily.get(date);
    if (focus) {
      cell.focusMinutes = Number(focus.focusMinutes) || 0;
      cell.focusCount = Number(focus.focusCount) || 0;
      cell.taskCount = Number(focus.taskCount) || 0;
      cell.points = Number(focus.points) || 0;
    }
    cell.tasks = (tasksByDay.get(date) || []).slice().sort((a, b) => (a.done === b.done ? 0 : a.done ? 1 : -1));
    cell.schedules = (schedulesByDay.get(date) || []).slice().sort((a, b) =>
      (a.timeMinutes == null ? Infinity : a.timeMinutes) - (b.timeMinutes == null ? Infinity : b.timeMinutes)
      || (a.createdAt || 0) - (b.createdAt || 0));
    cell.primaryTask = primaryTask(cell.tasks);
    cell.primarySchedule = cell.schedules.find((schedule) => !schedule.done) || cell.schedules[0] || null;
    const goal = overrides[dateKey(date)] != null ? Number(overrides[dateKey(date)]) : defaultGoal;
    cell.goal = Number.isInteger(goal) && goal > 0 ? goal : null;
    cell.goalSet = cell.goal !== null;
    const key = dateKey(date);
    cell.goalName = cell.goal !== null ? (goals.overrideNames && goals.overrideNames[key] || defaultGoalName) : "";
    cell.goalDescription = cell.goal !== null ? (goals.overrideDescriptions && goals.overrideDescriptions[key] || defaultGoalDescription) : "";
    cell.goals = goalItems.filter((item) => item && item.date === key).map((item) => ({
      id: item.id, name: typeof item.name === "string" ? item.name : "", description: typeof item.description === "string" ? item.description : "", minutes: Number(item.minutes) || 0,
    }));
    if (cell.goals.length) {
      cell.goalSet = true;
      cell.goal = cell.goals.reduce((total, item) => total + item.minutes, 0);
      cell.goalName = cell.goals.length === 1 ? cell.goals[0].name : `${cell.goals.length} goals`;
      cell.goalDescription = cell.goals.length === 1 ? cell.goals[0].description : "";
    }
    cell.goalMet = cell.goalSet && cell.focusMinutes >= cell.goal;
    focusMinutes += cell.focusMinutes;
    focusCount += cell.focusCount;
    taskCount += cell.taskCount;
    points += cell.points;
    cells.push(cell);
  }
  while (cells.length % 7) {
    const date = first + (cells.length - leading) * MS_DAY;
    const cell = emptyCell(date, today);
    cell.inMonth = false;
    cells.push(cell);
  }
  const weeks = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  const goalDays = cells.filter((cell) => cell.inMonth && cell.goalSet);
  return {
    year,
    month,
    weeks,
    summary: {
      focusMinutes, focusCount, taskCount, points, openTasksDue, schedulesTotal,
      goalDays: goalDays.length,
      goalsMetDays: goalDays.filter((cell) => cell.goalMet).length,
    },
  };
}

const api = { buildMonthGrid };
if (typeof module !== "undefined" && module.exports) module.exports = api;
if (typeof window !== "undefined") window.ClawdStudyCalendar = api;
