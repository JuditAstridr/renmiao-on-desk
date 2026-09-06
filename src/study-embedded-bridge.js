"use strict";

// The standalone Study window receives studyAPI from preload-study-dashboard.
// When the same page is loaded in Settings, the Settings preload owns the
// BrowserWindow and the iframe reuses its trusted study bridge instead.
(() => {
  let embedded = false;
  try {
    embedded = new URLSearchParams(window.location.search).get("embedded") === "1";
  } catch {}
  if (!embedded || window.studyAPI) return;
  try {
    const parentApi = window.parent && window.parent !== window ? window.parent.studyAPI : null;
    if (parentApi) window.studyAPI = parentApi;
  } catch (error) {
    console.warn("study embedded bridge unavailable:", error && error.message);
  }
})();
