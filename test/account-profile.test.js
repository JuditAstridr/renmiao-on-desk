"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_PROFILE_BYTES,
  defaultProfile,
  sanitizeProfile,
  profileSummary,
} = require("../src/account-profile");

test("account profile keeps pet, study, timer, and points data in one sanitized record", () => {
  const profile = sanitizeProfile({
    version: 999,
    pet: { themeId: "cloudling", variantId: "calm", tintId: "mint" },
    study: {
      tasks: [{ id: "task-1", title: "Read", done: false }],
      pomodoro: { phase: "focus", running: true, taskId: "task-1", remainingSeconds: 600 },
      points: { total: 120, today: 20, streak: 4, bestStreak: 5 },
    },
  });

  assert.equal(profile.version, 1);
  assert.equal(profile.pet.themeId, "cloudling");
  assert.equal(profile.study.tasks[0].title, "Read");
  assert.equal(profile.study.pomodoro.running, true);
  assert.equal(profile.study.points.total, 120);
  assert.deepEqual(profileSummary(profile), {
    themeId: "cloudling",
    variantId: "calm",
    taskCount: 1,
    completedTaskCount: 0,
    activeTaskTitle: "Read",
    pomodoroPhase: "focus",
    pomodoroRunning: true,
    pointsTotal: 120,
    streak: 4,
  });
});

test("oversized administrator input is trimmed to the profile wire budget", () => {
  const oversized = {
    pet: { themeId: "renmi" },
    study: {
      tasks: Array.from({ length: 500 }, (_value, index) => ({
        id: `task-${index}`,
        title: `Task ${index}`,
        subtasks: Array.from({ length: 100 }, (_subtask, subtaskIndex) => ({
          id: `subtask-${index}-${subtaskIndex}`,
          title: "A".repeat(500),
        })),
      })),
    },
  };
  const profile = sanitizeProfile(oversized);
  assert.ok(Buffer.byteLength(JSON.stringify(profile), "utf8") <= MAX_PROFILE_BYTES);
  assert.ok(profile.study.tasks.length < 500 || profile.study.tasks.some((task) => task.subtasks.length < 100));
});

test("missing account data resolves to stable defaults", () => {
  assert.deepEqual(sanitizeProfile(null), defaultProfile());
});
