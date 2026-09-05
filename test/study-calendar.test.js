"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const { buildMonthGrid } = require("../src/study-calendar");

const REF = new Date(2026, 8, 2, 12, 0, 0).getTime();
const MS_DAY = 86400000;

function cells(grid) {
  return grid.weeks.flat();
}

describe("study calendar month grid", () => {
  it("uses a Monday-first full-week layout", () => {
    const grid = buildMonthGrid({ year: 2026, month: 9, nowMs: REF });
    assert.equal(grid.weeks.length, 5);
    assert.equal(grid.weeks.every((week) => week.length === 7), true);
    assert.equal(cells(grid)[0].inMonth, false);
    assert.equal(cells(grid).filter((cell) => cell.inMonth).length, 30);
    assert.equal(cells(grid).find((cell) => cell.isToday).dayNum, 2);
  });

  it("places deadline tasks and schedules on their local date", () => {
    const first = new Date(2026, 8, 1).getTime();
    const day = first + 4 * MS_DAY;
    const grid = buildMonthGrid({
      year: 2026, month: 9, nowMs: REF,
      tasks: [{ id: "open", title: "Essay", deadline: day, done: false }],
      schedules: [{ id: "event", title: "Exam", date: day, timeMinutes: 540, done: false }],
    });
    const cell = cells(grid).find((entry) => entry.date === day);
    assert.deepEqual(cell.tasks.map((entry) => entry.id), ["open"]);
    assert.deepEqual(cell.schedules.map((entry) => entry.id), ["event"]);
    assert.equal(grid.summary.openTasksDue, 1);
    assert.equal(grid.summary.schedulesTotal, 1);
  });

  it("resolves default and per-day goals", () => {
    const first = new Date(2026, 8, 1).getTime();
    const overrideDay = first + MS_DAY;
    const key = "2026-09-02";
    const grid = buildMonthGrid({
      year: 2026, month: 9, nowMs: REF,
      daily: [{ day: overrideDay, focusMinutes: 40, focusCount: 2 }],
      goals: { defaultMinutes: 60, overrides: { [key]: 30 } },
    });
    const cell = cells(grid).find((entry) => entry.date === overrideDay);
    assert.equal(cell.goal, 30);
    assert.equal(cell.goalMet, true);
    assert.equal(grid.summary.goalDays, 30);
    assert.equal(grid.summary.goalsMetDays, 1);
  });

  it("chooses the earliest schedule and most urgent open task as the summary", () => {
    const day = new Date(2026, 8, 2).getTime();
    const grid = buildMonthGrid({
      year: 2026, month: 9, nowMs: REF,
      schedules: [
        { id: "late", title: "Dinner", date: day, timeMinutes: 1140, createdAt: 2 },
        { id: "early", title: "Lecture", date: day, timeMinutes: 540, createdAt: 1 },
      ],
      tasks: [
        { id: "low", title: "Low", deadline: day, quadrant: 3, done: false, createdAt: 1 },
        { id: "urgent", title: "Urgent", deadline: day, quadrant: 0, done: false, createdAt: 2 },
      ],
    });
    const cell = cells(grid).find((entry) => entry.date === day);
    assert.equal(cell.primarySchedule.id, "early");
    assert.equal(cell.primaryTask.id, "urgent");
  });
});
