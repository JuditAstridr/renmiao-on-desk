"use strict";

// Pure study-report aggregation.  The renderer uses this through the main
// process so account-scoped study history never becomes a second persistence
// or IPC source of truth.

const MS_DAY = 86400000;

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function weekRange(nowMs) {
  const day = new Date(nowMs).getDay();
  const mondayOffset = (day + 6) % 7;
  const from = startOfDay(nowMs) - mondayOffset * MS_DAY;
  return { from, to: from + 7 * MS_DAY - 1 };
}

function monthRange(nowMs, offset = 0) {
  const date = new Date(nowMs);
  const first = new Date(date.getFullYear(), date.getMonth() + offset, 1).getTime();
  const next = new Date(date.getFullYear(), date.getMonth() + offset + 1, 1).getTime();
  return { from: first, to: next - 1 };
}

function rangeFor(spec, nowMs = Date.now()) {
  const unit = spec && spec.unit === "month" ? "month" : "week";
  const offset = spec && Number.isInteger(spec.offset) ? spec.offset : 0;
  if (unit === "month") return monthRange(nowMs, offset);
  const base = weekRange(nowMs);
  return { from: base.from + offset * 7 * MS_DAY, to: base.to + offset * 7 * MS_DAY };
}

function inRange(event, range) {
  return event && Number.isFinite(event.at) && event.at >= range.from && event.at <= range.to;
}

function emptyDay(day) {
  return { day, focusCount: 0, focusMinutes: 0, taskCount: 0, points: 0 };
}

function buildTrend(unit, daily, firstDay) {
  const buckets = unit === "week"
    ? daily.map((entry) => ({ start: entry.day, focusMinutes: entry.focusMinutes, focusCount: entry.focusCount, taskCount: entry.taskCount, points: entry.points }))
    : (() => {
      const map = new Map();
      for (const entry of daily) {
        const index = Math.floor((entry.day - firstDay) / (7 * MS_DAY));
        const bucket = map.get(index) || { start: firstDay + index * 7 * MS_DAY, focusMinutes: 0, focusCount: 0, taskCount: 0, points: 0 };
        bucket.focusMinutes += entry.focusMinutes;
        bucket.focusCount += entry.focusCount;
        bucket.taskCount += entry.taskCount;
        bucket.points += entry.points;
        map.set(index, bucket);
      }
      const last = daily.length ? Math.floor((daily[daily.length - 1].day - firstDay) / (7 * MS_DAY)) : 0;
      return Array.from({ length: last + 1 }, (_value, index) => map.get(index) || {
        start: firstDay + index * 7 * MS_DAY, focusMinutes: 0, focusCount: 0, taskCount: 0, points: 0,
      });
    })();
  const active = buckets.filter((bucket) => bucket.focusMinutes > 0 || bucket.taskCount > 0 || bucket.points > 0);
  const first = active[0] && active[0].focusMinutes;
  const last = active.length && active[active.length - 1].focusMinutes;
  const growthPct = first > 0 ? Math.round(((last - first) / first) * 100) : null;
  const best = active.reduce((winner, bucket, index) => {
    if (!winner || bucket.focusMinutes > winner.focusMinutes) return { index: buckets.indexOf(bucket), focusMinutes: bucket.focusMinutes };
    return winner;
  }, null);
  return {
    bucketUnit: unit === "week" ? "day" : "week",
    buckets,
    activeCount: active.length,
    growthPct,
    improving: growthPct != null && growthPct >= 5,
    bestBucket: best,
  };
}

function trailingWeeks(history, nowMs) {
  const current = weekRange(nowMs).from;
  return Array.from({ length: 8 }, (_value, index) => {
    const start = current - (7 - index) * 7 * MS_DAY;
    const end = start + 7 * MS_DAY;
    const events = history.filter((event) => event.kind === "focus" && event.at >= start && event.at < end);
    return { start, focusMinutes: events.reduce((sum, event) => sum + event.minutes, 0), focusCount: events.length };
  });
}

function buildReport(data = {}, spec, nowMs = Date.now()) {
  const history = Array.isArray(data.history) ? data.history : [];
  const range = rangeFor(spec, nowMs);
  const events = history.filter((event) => inRange(event, range));
  const totals = { focusCount: 0, focusMinutes: 0, taskCount: 0, points: 0 };
  const quadrantCounts = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const categoryMap = new Map();
  for (const event of events) {
    totals.points += Number(event.points) || 0;
    if (event.kind === "focus") {
      totals.focusCount += 1;
      totals.focusMinutes += Number(event.minutes) || 0;
      const key = event.category || null;
      const item = categoryMap.get(key) || { category: key, minutes: 0, count: 0 };
      item.minutes += Number(event.minutes) || 0;
      item.count += 1;
      categoryMap.set(key, item);
    } else if (event.kind === "task") {
      totals.taskCount += 1;
      if (Object.prototype.hasOwnProperty.call(quadrantCounts, event.quadrant)) quadrantCounts[event.quadrant] += 1;
    }
  }

  const firstDay = startOfDay(range.from);
  const lastDay = startOfDay(range.to);
  const byDay = new Map();
  for (const event of events) {
    const day = startOfDay(event.at);
    const entry = byDay.get(day) || emptyDay(day);
    entry.points += Number(event.points) || 0;
    if (event.kind === "focus") {
      entry.focusCount += 1;
      entry.focusMinutes += Number(event.minutes) || 0;
    } else if (event.kind === "task") entry.taskCount += 1;
    byDay.set(day, entry);
  }
  const daily = [];
  for (let day = firstDay; day <= lastDay; day += MS_DAY) daily.push(byDay.get(day) || emptyDay(day));
  const categories = [...categoryMap.values()].sort((a, b) => b.minutes - a.minutes || String(a.category || "").localeCompare(String(b.category || "")));

  const focusEvents = events.filter((event) => event.kind === "focus");
  const taskEvents = events.filter((event) => event.kind === "task");
  const latestFocusEvent = focusEvents.reduce((latest, event) => (!latest || event.at > latest.at ? event : latest), null);
  const bestDay = daily.filter((day) => day.focusMinutes || day.taskCount || day.points)
    .reduce((best, day) => (!best || day.focusMinutes > best.focusMinutes ? day : best), null);
  const extremeDeadline = taskEvents.filter((event) => event.deadline != null)
    .reduce((closest, event) => {
      const gapMinutes = Math.round((event.deadline - event.at) / 60000);
      return !closest || gapMinutes < closest.gapMinutes
        ? { at: event.at, taskTitle: event.taskTitle, deadline: event.deadline, gapMinutes }
        : closest;
    }, null);
  const elapsed = taskEvents.map((event) => event.elapsedMinutes).filter(Number.isInteger);
  const avgTaskMinutes = elapsed.length ? Math.round(elapsed.reduce((sum, value) => sum + value, 0) / elapsed.length) : null;
  const story = taskEvents.filter((event) => event.focusMinutes > 0).reduce((best, event) => {
    const startedAt = event.startedAt || event.at - (event.elapsedMinutes || 0) * 60000;
    const candidate = {
      taskTitle: event.taskTitle, startedAt, completedAt: event.at,
      days: Math.max(1, Math.ceil((event.at - startedAt) / MS_DAY)), focusMinutes: event.focusMinutes,
    };
    return !best || candidate.days > best.days || (candidate.days === best.days && candidate.focusMinutes > best.focusMinutes)
      ? candidate : best;
  }, null);

  const unit = spec && spec.unit === "month" ? "month" : "week";
  return {
    unit,
    offset: spec && Number.isInteger(spec.offset) ? spec.offset : 0,
    range,
    totals,
    daily,
    quadrantCounts,
    categories,
    trend: buildTrend(unit, daily, firstDay),
    longTerm: (() => {
      const weeks = trailingWeeks(history, nowMs);
      const old = weeks.slice(0, 4).reduce((sum, week) => sum + week.focusMinutes, 0);
      const recent = weeks.slice(4).reduce((sum, week) => sum + week.focusMinutes, 0);
      return { weeks, spanWeeks: weeks.length, improving: recent > 0 && recent > old };
    })(),
    facts: {
      latestFocus: latestFocusEvent ? { at: latestFocusEvent.at, taskTitle: latestFocusEvent.taskTitle || null, minutes: latestFocusEvent.minutes } : null,
      extremeDeadline,
      bestDay: bestDay ? { day: bestDay.day, focusMinutes: bestDay.focusMinutes, points: bestDay.points } : null,
      avgTaskMinutes,
      story,
    },
    allTime: {
      total: Number.isInteger(data.points && data.points.total) ? data.points.total : 0,
      streak: Number.isInteger(data.points && data.points.streak) ? data.points.streak : 0,
      bestStreak: Number.isInteger(data.points && data.points.bestStreak) ? data.points.bestStreak : 0,
    },
  };
}

module.exports = { buildReport, rangeFor };
