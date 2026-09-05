"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildReport, rangeFor } = require("../src/study-report");

const REF = new Date(2026, 8, 2, 12, 0, 0).getTime();

function focus(at, extra = {}) {
  return { kind: "focus", at, minutes: 25, points: 25, category: null, ...extra };
}

function task(at, extra = {}) {
  return {
    kind: "task", at, points: 30, taskId: "task", taskTitle: "Task", category: null,
    quadrant: null, deadline: null, elapsedMinutes: 60, focusMinutes: 25, ...extra,
  };
}

describe("study report engine", () => {
  it("uses local Monday-to-Sunday weeks and calendar month offsets", () => {
    const week = rangeFor({ unit: "week", offset: 0 }, REF);
    assert.equal(new Date(week.from).getDay(), 1);
    assert.equal(new Date(week.to).getDay(), 0);
    const previousMonth = rangeFor({ unit: "month", offset: -1 }, REF);
    assert.equal(new Date(previousMonth.from).getMonth(), 7);
    assert.equal(new Date(previousMonth.to).getDate(), 31);
  });

  it("aggregates focus, task, points, categories, and a zero-filled day axis", () => {
    const monday = rangeFor({ unit: "week", offset: 0 }, REF).from;
    const report = buildReport({
      history: [
        focus(monday + 60 * 60 * 1000, { category: "school" }),
        focus(monday + 86400000 + 60 * 60 * 1000, { category: "school" }),
        task(monday + 2 * 86400000, { quadrant: 0, points: 45 }),
      ],
      points: { total: 200, streak: 3, bestStreak: 5 },
    }, { unit: "week", offset: 0 }, REF);
    assert.deepEqual(report.totals, { focusCount: 2, focusMinutes: 50, taskCount: 1, points: 95 });
    assert.equal(report.daily.length, 7);
    assert.equal(report.quadrantCounts[0], 1);
    assert.deepEqual(report.categories, [{ category: "school", minutes: 50, count: 2 }]);
    assert.equal(report.allTime.total, 200);
  });

  it("buckets month activity into weeks and identifies the best day", () => {
    const first = rangeFor({ unit: "month", offset: 0 }, REF).from;
    const report = buildReport({
      history: [
        focus(first + 60 * 60 * 1000),
        focus(first + 8 * 86400000 + 60 * 60 * 1000),
        focus(first + 8 * 86400000 + 2 * 60 * 60 * 1000),
      ],
      points: {},
    }, { unit: "month", offset: 0 }, REF);
    assert.equal(report.trend.bucketUnit, "week");
    assert.deepEqual(report.trend.buckets.slice(0, 2).map((entry) => entry.focusMinutes), [25, 50]);
    assert.equal(report.facts.bestDay.focusMinutes, 50);
  });

  it("keeps completion stories limited to tasks with real focus", () => {
    const monday = rangeFor({ unit: "week", offset: 0 }, REF).from;
    const report = buildReport({
      history: [
        task(monday + 86400000, { taskTitle: "Manual", focusMinutes: 0 }),
        task(monday + 2 * 86400000, { taskTitle: "Focused", focusMinutes: 120, startedAt: monday }),
      ],
      points: {},
    }, { unit: "week", offset: 0 }, REF);
    assert.equal(report.facts.story.taskTitle, "Focused");
    assert.equal(report.facts.story.days, 2);
  });
});
