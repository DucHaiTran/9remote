// In-memory cache for the git graph of ONE repo: the last one opened. Opening another
// repo's graph drops it. Lives for the page's lifetime, so tab switches, closing the
// panel or leaving the git screen all reopen instantly; a page reload starts empty.
import { GIT_GRAPH_UI } from "../constants/fileExplorer.js";

let slot = null; // { repo, ...view state, details: Map }

function slotFor(repo) {
  if (!slot || slot.repo !== repo) slot = { repo, details: new Map() };
  return slot;
}

export function readGraphCache(repo) {
  return slot && slot.repo === repo ? slot : null;
}

export function writeGraphCache(repo, patch) {
  Object.assign(slotFor(repo), patch);
}

// Commit details and file diffs never change for a given hash, so they are kept until the repo changes.
export function readGraphDetail(repo, key) {
  return readGraphCache(repo)?.details.get(key);
}

export function writeGraphDetail(repo, key, value) {
  const { details } = slotFor(repo);
  details.delete(key);
  details.set(key, value);
  if (details.size > GIT_GRAPH_UI.DETAIL_CACHE_MAX) details.delete(details.keys().next().value);
}
