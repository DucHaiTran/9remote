"use client";

import { useEffect, useRef } from "react";

// Back (Android gesture, browser button) closes the topmost open layer — a modal, menu,
// details pane — instead of leaving the page. Each open layer pushes a history entry on
// the SAME url; Back pops it and the layer closes. A layer closed from the UI never calls
// history.back() (it could race a navigation started by the same click); its entry turns
// stale instead, and the next Back that leaves a stale entry steps once more, so that
// press still lands on the previous page.

const KEY = "__backLayer";
const open = []; // layer ids, oldest first
const stale = new Set();
let seq = 0;
let currentId = null; // layer id of the history entry we are on, as far as we know
// Chrome skips on Back an entry the page left via pushState with no gesture since arriving
// on it, and a gesture made before a Back still reads as navigator.userActivation.isActive.
let gestureSinceNav = false;

function onPopState(e) {
  gestureSinceNav = false;
  const leftId = currentId;
  const arrivedId = e.state?.[KEY] ?? null;
  currentId = arrivedId;
  const top = open[open.length - 1];
  if (top && top.id !== arrivedId) {
    open.pop();
    top.closedByBack = true;
    top.close();
    return;
  }
  if (leftId !== null && stale.has(leftId) && arrivedId !== leftId) {
    stale.delete(leftId);
    history.back();
  }
}

// One listener per page; a hot-reloaded copy of this module swaps out the old one.
function listen() {
  if (window.__backCloseListener === onPopState) return;
  if (window.__backCloseListener) window.removeEventListener("popstate", window.__backCloseListener);
  const oldGesture = window.__backCloseGesture;
  if (typeof oldGesture === "function") GESTURE_EVENTS.forEach((ev) => window.removeEventListener(ev, oldGesture, true));
  window.__backCloseListener = onPopState;
  window.__backCloseGesture = markGesture;
  window.addEventListener("popstate", onPopState);
  GESTURE_EVENTS.forEach((ev) => window.addEventListener(ev, markGesture, true));
}

// Touch pointerup fires before the browser grants activation; only count events that carry it.
function hasActivation() {
  return navigator.userActivation ? navigator.userActivation.isActive : true;
}

function markGesture() {
  if (hasActivation()) gestureSinceNav = true;
}

// Events that grant user activation; pointerdown does not on touch screens.
const GESTURE_EVENTS = ["pointerup", "touchend", "click", "keydown"];

// `gesture`: push only while the user is interacting. Some browsers (Samsung Internet) skip
// on Back any entry a page pushed outside a gesture, so the push waits for the next tap.
export function useBackClose(onClose, enabled = true, { gesture = false } = {}) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });

  useEffect(() => {
    if (!enabled) return;
    listen();
    const layer = { id: ++seq, closedByBack: false, pushed: false, close: () => closeRef.current?.() };
    const push = () => {
      if (layer.pushed) return;
      layer.pushed = true;
      open.push(layer);
      history.pushState({ ...history.state, [KEY]: layer.id }, "", location.href);
      currentId = layer.id;
    };
    // Back landed on an entry a closed layer left behind: take it over instead of pushing.
    const hereId = history.state?.[KEY];
    const adopt = () => {
      stale.delete(hereId);
      layer.id = hereId;
      layer.pushed = true;
      open.push(layer);
      currentId = hereId;
    };
    const waitOpts = { capture: true };
    const onGesture = () => {
      if (!hasActivation()) return;
      GESTURE_EVENTS.forEach((ev) => window.removeEventListener(ev, onGesture, waitOpts));
      push();
    };
    if (hereId != null && stale.has(hereId)) adopt();
    else if (!gesture || (gestureSinceNav && hasActivation())) push();
    else GESTURE_EVENTS.forEach((ev) => window.addEventListener(ev, onGesture, waitOpts));
    return () => {
      GESTURE_EVENTS.forEach((ev) => window.removeEventListener(ev, onGesture, waitOpts));
      if (!layer.pushed || layer.closedByBack) return;
      const i = open.indexOf(layer);
      if (i !== -1) open.splice(i, 1);
      stale.add(layer.id);
    };
  }, [enabled, gesture]);
}
