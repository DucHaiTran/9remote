// Desktop tab layout, Chrome style. Every session is a tab and shows alone. Two tabs put in
// a split view share the screen and sit in the strip as one joined tab; tabs in a group sit
// together behind a coloured label and show side by side when one is picked. Display only —
// sessions keep running whatever their layout — and stored per browser.
//
// State per workspace: { groups: [{ id, name, color, sessionIds, weights, collapsed }],
// splits: [{ id, ids: [left, right], weights }] }. `weights` are flex shares (missing = 1).

// Chrome's group colours. A new group takes the first one not in use; grey comes last
// because it barely shows against the dark tab strip.
export const GROUP_COLORS = {
  blue: "#5b8def",
  red: "#e5534b",
  yellow: "#d9a53a",
  green: "#3fb27f",
  pink: "#e26fa8",
  purple: "#a371f7",
  cyan: "#39b8c4",
  orange: "#ee8a3c",
  grey: "#8b919c"
};
const COLOR_KEYS = Object.keys(GROUP_COLORS);

let seq = 0;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
const newGroupId = () => newId("tg");

const EMPTY = { groups: [], splits: [] };

// Fit stored groups to the workspace's sessions: gone sessions leave, a session in two
// groups keeps the first, and a group left empty disappears.
export function normalizeTabGroups(raw, sessionIds) {
  const live = new Set(sessionIds);
  const placed = new Set();
  const groups = [];
  for (const group of raw?.groups || []) {
    const ids = (group.sessionIds || []).filter((id) => live.has(id) && !placed.has(id));
    if (!ids.length) continue;
    ids.forEach((id) => placed.add(id));
    const weights = Object.fromEntries(Object.entries(group.weights || {}).filter(([id]) => ids.includes(id)));
    groups.push({
      id: group.id,
      name: group.name || null,
      color: GROUP_COLORS[group.color] ? group.color : COLOR_KEYS[0],
      sessionIds: ids,
      weights,
      collapsed: !!group.collapsed
    });
  }
  // A split needs both halves alive, and a tab sits in one split at most.
  const split = new Set();
  const splits = [];
  for (const pair of raw?.splits || []) {
    const ids = (pair.ids || []).filter((id) => live.has(id) && !split.has(id));
    if (ids.length !== 2) continue;
    ids.forEach((id) => split.add(id));
    const weights = Object.fromEntries(Object.entries(pair.weights || {}).filter(([id]) => ids.includes(id)));
    splits.push({ id: pair.id, ids, weights });
  }
  return groups.length || splits.length ? { groups, splits } : EMPTY;
}

// A state saved before splits existed has no `splits` key; it still means "none".
const canonical = (x) => JSON.stringify({ groups: x?.groups || [], splits: x?.splits || [] });
export const sameTabGroups = (a, b) => canonical(a) === canonical(b);

export const groupOfSession = (state, sessionId) => state?.groups.find((g) => g.sessionIds.includes(sessionId)) || null;

export const splitOfSession = (state, sessionId) => state?.splits?.find((p) => p.ids.includes(sessionId)) || null;

// "Open in split view": the two tabs leave any other split and any group, and become one
// joined tab with `left` on the left.
export function createSplit(state, left, right) {
  if (!left || !right || left === right) return state;
  const groups = withoutSession(withoutSession(state.groups, left), right);
  const splits = (state.splits || []).filter((p) => !p.ids.includes(left) && !p.ids.includes(right));
  return { groups, splits: [...splits, { id: newId("sp"), ids: [left, right], weights: {} }] };
}

export const separateSplit = (state, splitId) => ({ ...state, splits: (state.splits || []).filter((p) => p.id !== splitId) });

export const swapSplit = (state, splitId) => ({
  ...state,
  splits: (state.splits || []).map((p) => (p.id === splitId ? { ...p, ids: [p.ids[1], p.ids[0]] } : p))
});

export const updateSplit = (state, splitId, patch) => ({
  ...state,
  splits: (state.splits || []).map((p) => (p.id === splitId ? { ...p, ...patch } : p))
});

const withoutSession = (groups, sessionId) => groups
  .map((g) => ({ ...g, sessionIds: g.sessionIds.filter((id) => id !== sessionId) }))
  .filter((g) => g.sessionIds.length);

// "Add tab to new group": a group of one, named nothing, in the next free colour.
export function createGroup(state, sessionId) {
  const used = new Set(state.groups.map((g) => g.color));
  const color = COLOR_KEYS.find((c) => !used.has(c)) || COLOR_KEYS[state.groups.length % COLOR_KEYS.length];
  const groups = withoutSession(state.groups, sessionId);
  return { splits: (state.splits || []).filter((p) => !p.ids.includes(sessionId)), groups: [...groups, { id: newGroupId(), name: null, color, sessionIds: [sessionId], weights: {}, collapsed: false }] };
}

// "Add tab to group": joins at the end (or right after `afterId`, a tab already in it).
export function addToGroup(state, sessionId, groupId, afterId = null) {
  state = { ...state, splits: (state.splits || []).filter((p) => !p.ids.includes(sessionId)) };
  const groups = withoutSession(state.groups, sessionId).map((g) => {
    if (g.id !== groupId) return g;
    const ids = [...g.sessionIds];
    const at = afterId ? ids.indexOf(afterId) : -1;
    ids.splice(at === -1 ? ids.length : at + 1, 0, sessionId);
    return { ...g, sessionIds: ids, collapsed: false };
  });
  return { ...state, groups };
}

export const removeFromGroup = (state, sessionId) => ({ ...state, groups: withoutSession(state.groups, sessionId) });

export const ungroup = (state, groupId) => ({ ...state, groups: state.groups.filter((g) => g.id !== groupId) });

export const updateGroup = (state, groupId, patch) => ({
  ...state,
  groups: state.groups.map((g) => (g.id === groupId ? { ...g, ...patch } : g))
});

// The header's order with each group's tabs pulled together where its first tab sits, each
// run preceded by its label, and a split pair as one joined entry where its first half sits:
// [{ type: "group", group }, { type: "tab", id, group }, { type: "split", split }, …].
export function stripItems(state, orderedIds) {
  const items = [];
  const emitted = new Set();
  for (const id of orderedIds) {
    if (emitted.has(id)) continue;
    const pair = splitOfSession(state, id);
    if (pair) {
      if (pair.ids.every((m) => orderedIds.includes(m))) {
        items.push({ type: "split", split: pair });
        pair.ids.forEach((m) => emitted.add(m));
        continue;
      }
    }
    const group = groupOfSession(state, id);
    if (!group) { items.push({ type: "tab", id, group: null }); emitted.add(id); continue; }
    items.push({ type: "group", group });
    const members = group.sessionIds.filter((m) => orderedIds.includes(m));
    for (const m of members) { emitted.add(m); if (!group.collapsed) items.push({ type: "tab", id: m, group }); }
  }
  return items;
}

// Chrome's drop rule after a tab drag: landing between two tabs of one group joins it;
// landing clear of its own group's tabs leaves it.
export function regroupAfterDrop(state, orderedIds, movedId) {
  const at = orderedIds.indexOf(movedId);
  if (at === -1 || splitOfSession(state, movedId)) return state;
  const left = groupOfSession(state, orderedIds[at - 1]);
  const right = groupOfSession(state, orderedIds[at + 1]);
  const own = groupOfSession(state, movedId);
  if (left && right && left.id === right.id) {
    return own?.id === left.id ? state : addToGroup(state, movedId, left.id, orderedIds[at - 1]);
  }
  if (own && left?.id !== own.id && right?.id !== own.id) return removeFromGroup(state, movedId);
  return state;
}

// Pixel widths to flex shares averaging 1, so a stored weight stays comparable to a missing one.
export function weightsFromWidths(widths) {
  const values = Object.values(widths);
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  if (!(mean > 0)) return {};
  return Object.fromEntries(Object.entries(widths).map(([id, w]) => [id, Math.round((w / mean) * 1000) / 1000]));
}
