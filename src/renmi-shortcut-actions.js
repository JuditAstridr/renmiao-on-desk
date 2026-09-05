"use strict";

// The Renmi product has one global shortcut: show or hide the pet.  Keep this
// parser independent from the historical Clawd shortcut table so permission
// shortcut identifiers can never enter the Renmi settings schema.

const DEFAULT_ACCELERATOR = "CommandOrControl+Shift+Alt+C";
const MODIFIER_ORDER = Object.freeze(["CommandOrControl", "Shift", "Alt"]);
const MODIFIER_ALIASES = Object.freeze({
  cmdorctrl: "CommandOrControl",
  cmdorcontrol: "CommandOrControl",
  commandorcontrol: "CommandOrControl",
  commandorctrl: "CommandOrControl",
  ctrl: "CommandOrControl",
  control: "CommandOrControl",
  command: "CommandOrControl",
  cmd: "CommandOrControl",
  shift: "Shift",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
});
const NAMED_KEYS = Object.freeze({
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  enter: "Enter",
  return: "Enter",
  escape: "Escape",
  esc: "Escape",
  up: "Up",
  arrowup: "Up",
  down: "Down",
  arrowdown: "Down",
  left: "Left",
  arrowleft: "Left",
  right: "Right",
  arrowright: "Right",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
});
const DANGEROUS_ACCELERATORS = new Set([
  "CommandOrControl+C",
  "CommandOrControl+V",
  "CommandOrControl+X",
  "CommandOrControl+Z",
  "CommandOrControl+A",
  "CommandOrControl+S",
  "CommandOrControl+Q",
  "CommandOrControl+W",
  "CommandOrControl+R",
  "Alt+F4",
  "F5",
]);

function normalizeKey(token) {
  const value = String(token || "").trim();
  if (/^[a-z0-9]$/i.test(value)) return value.toUpperCase();
  if (/^f(?:[1-9]|1\d|2[0-4])$/i.test(value)) return value.toUpperCase();
  return NAMED_KEYS[value.replace(/\s+/g, "").toLowerCase()] || null;
}

function parseAccelerator(value) {
  if (typeof value !== "string") return null;
  const parts = value.split("+").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const modifiers = new Set();
  let key = null;
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.replace(/\s+/g, "").toLowerCase()];
    if (modifier) {
      if (modifiers.has(modifier)) return null;
      modifiers.add(modifier);
      continue;
    }
    if (key || !(key = normalizeKey(part))) return null;
  }
  if (!key || modifiers.size === 0) return null;
  return {
    accelerator: [...MODIFIER_ORDER.filter((item) => modifiers.has(item)), key].join("+"),
  };
}

function isDangerousAccelerator(value) {
  return DANGEROUS_ACCELERATORS.has(value);
}

function getDefaultShortcuts() {
  return { togglePet: DEFAULT_ACCELERATOR };
}

module.exports = {
  DEFAULT_ACCELERATOR,
  parseAccelerator,
  isDangerousAccelerator,
  getDefaultShortcuts,
};
