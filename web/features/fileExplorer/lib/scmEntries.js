// Splits `git status` rows into the Source Control sections and builds their folder tree.
// A file staged and then edited again sits in both Staged and Changes, as in VS Code.

const CLEAN = " ";
const UNTRACKED = "?";
const IGNORED = "!";

// Hosts before 3.0.62 send only `status`: treat every row as unstaged, as they always did.
function columnsOf(file) {
  if (file.index !== undefined) return { x: file.index, y: file.worktree };
  return file.status === UNTRACKED ? { x: UNTRACKED, y: UNTRACKED } : { x: CLEAN, y: file.status };
}

export function splitScmFiles(files) {
  const staged = [];
  const changes = [];
  const untracked = [];
  for (const file of files) {
    const { x, y } = columnsOf(file);
    if (x === UNTRACKED) {
      untracked.push({ ...file, status: UNTRACKED, hasStaged: false });
      continue;
    }
    const hasStaged = x !== CLEAN && x !== IGNORED;
    if (hasStaged) staged.push({ ...file, status: x, hasStaged });
    if (y !== CLEAN && y !== IGNORED) changes.push({ ...file, status: y, hasStaged });
  }
  return { staged, changes, untracked };
}

// Folders, then files, by name. A folder holding a single folder merges into "a/b" (compact folders).
export function buildScmTree(entries) {
  const root = { dirs: new Map(), files: [] };
  for (const entry of entries) {
    const parts = entry.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(entry);
  }
  return toNodes(root, "");
}

function toNodes(node, prefix) {
  const dirs = [...node.dirs.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, child]) => {
    let label = name;
    let path = prefix ? `${prefix}/${name}` : name;
    let cur = child;
    while (cur.files.length === 0 && cur.dirs.size === 1) {
      const [[nextName, next]] = cur.dirs.entries();
      label = `${label}/${nextName}`;
      path = `${path}/${nextName}`;
      cur = next;
    }
    const children = toNodes(cur, path);
    return { type: "dir", name: label, path, children, paths: collectPaths(children) };
  });
  const files = [...node.files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => ({ type: "file", path: entry.path, entry }));
  return [...dirs, ...files];
}

function collectPaths(nodes) {
  return nodes.flatMap((n) => (n.type === "dir" ? n.paths : [n.path]));
}
