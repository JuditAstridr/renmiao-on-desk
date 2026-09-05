"use strict";

const area = document.getElementById("hit-area");
let config = window.hitThemeConfig || {};
let currentState = "idle";
let miniMode = false;
let dragging = false;
let didDrag = false;
let downX = 0;
let downY = 0;
let lastX = 0;
let activePointerId = null;
let lastScreenPoint = null;
let dragMoveFrame = null;
let reactionTimer = null;
const DRAG_THRESHOLD = 3;

function sync(data) {
  if (!data || typeof data !== "object") return;
  if (typeof data.currentState === "string") currentState = data.currentState;
  if (typeof data.miniMode === "boolean") {
    miniMode = data.miniMode;
    area.style.cursor = miniMode ? "default" : "grab";
  }
}

window.hitAPI.onThemeConfig((next) => { config = next || {}; });
window.hitAPI.onStateSync(sync);
window.hitAPI.onCancelReaction(() => {
  if (reactionTimer) clearTimeout(reactionTimer);
  reactionTimer = null;
});

function startReaction(direction) {
  if (currentState !== "idle" || miniMode) return;
  const entry = direction === "left" ? config.reactions?.clickLeft : config.reactions?.clickRight;
  if (!entry || !entry.file) return;
  window.hitAPI.playClickReaction(entry.file, entry.duration || 2500);
  if (reactionTimer) clearTimeout(reactionTimer);
  reactionTimer = setTimeout(() => { reactionTimer = null; }, entry.duration || 2500);
}

function scheduleDragMove() {
  if (dragMoveFrame !== null) return;
  const run = () => {
    dragMoveFrame = null;
    if (dragging && didDrag && !miniMode) window.hitAPI.dragMove(lastScreenPoint);
  };
  if (typeof requestAnimationFrame === "function") dragMoveFrame = requestAnimationFrame(run);
  else dragMoveFrame = setTimeout(run, 0);
}

function cancelScheduledDragMove() {
  if (dragMoveFrame === null) return;
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(dragMoveFrame);
  else clearTimeout(dragMoveFrame);
  dragMoveFrame = null;
}

area.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  window.hitAPI.showContextMenu();
});

area.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  activePointerId = event.pointerId;
  dragging = true;
  didDrag = false;
  downX = lastX = event.clientX;
  downY = event.clientY;
  lastScreenPoint = getScreenPoint(event);
  area.setPointerCapture?.(event.pointerId);
  if (miniMode) return;
  area.classList.add("dragging");
  window.hitAPI.dragLock(true, lastScreenPoint);
});

document.addEventListener("pointermove", (event) => {
  if (!dragging || miniMode || event.pointerId !== activePointerId) return;
  lastScreenPoint = getScreenPoint(event) || lastScreenPoint;
  const dx = event.clientX - downX;
  const dy = event.clientY - downY;
  if (!didDrag && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
    didDrag = true;
    window.hitAPI.startDragReaction(dx < 0 ? "left" : "right");
  }
  if (didDrag && event.clientX !== lastX) {
    window.hitAPI.startDragReaction(event.clientX < lastX ? "left" : "right");
  }
  lastX = event.clientX;
  if (didDrag) scheduleDragMove();
});

function finishPointer(event = {}) {
  if (!dragging) return;
  if (event.pointerId != null && event.pointerId !== activePointerId) return;
  cancelScheduledDragMove();
  const wasDrag = didDrag;
  dragging = false;
  activePointerId = null;
  lastScreenPoint = null;
  area.classList.remove("dragging");
  window.hitAPI.dragLock(false);
  if (wasDrag) {
    window.hitAPI.dragEnd();
    window.hitAPI.endDragReaction();
    return;
  }
  if (miniMode) {
    window.hitAPI.exitMiniMode();
    return;
  }
  startReaction(Number(event.clientX) < area.offsetWidth / 2 ? "left" : "right");
}

document.addEventListener("pointerup", (event) => {
  if (event.button !== 0) return;
  finishPointer(event);
});
area.addEventListener("pointercancel", () => finishPointer());
area.addEventListener("lostpointercapture", (event) => {
  // On some Electron/macOS builds capture can be reported as lost while the
  // button is still held. Do not turn that transient notification into a
  // drag end; pointerup/pointercancel/blur remain the authoritative cleanup.
  if (Number.isFinite(event.buttons) && event.buttons !== 0) return;
  finishPointer(event);
});
window.addEventListener("blur", () => finishPointer());

function getScreenPoint(event) {
  if (!event || !Number.isFinite(event.screenX) || !Number.isFinite(event.screenY)) return null;
  return { x: event.screenX, y: event.screenY };
}
