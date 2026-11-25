// Commit graph (Git Graph-style): paged log with parents + refs, commit details, per-commit
// file diffs, and the ref/commit actions offered from the graph.
import { runGit } from "./GitHandler.js";
import { isHash, isRefName } from "./gitArgs.js";
import { GIT_GRAPH, MAX_GIT_DIFF_SIZE } from "../constants.js";
import { findGitRoot } from "../../terminal/workspaceMigration.js";

const FIELD = "\x1f";
const RECORD = "\x1e";
const NOT_A_REPO = "Not a git repository";
// Git's well-known empty tree ids — the base a root commit is diffed against.
const EMPTY_TREE = {
  sha1: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  sha256: "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321",
};

const failWith = (callback, r) => callback({ success: false, error: (r.stderr || r.stdout).trim() || "git failed" });
const okOutput = (callback, r) => callback({ success: true, output: (r.stdout + r.stderr).trim() });

function capDiff(diff) {
  if (diff.length <= MAX_GIT_DIFF_SIZE) return diff;
  return `${diff.slice(0, MAX_GIT_DIFF_SIZE)}\n\n... diff truncated (over ${Math.round(MAX_GIT_DIFF_SIZE / 1024 / 1024)}MB)`;
}

// refs/heads/x → head, refs/remotes/o/x → remote, refs/tags/x → tag; peeled tags point at their commit.
async function readRefs(repoPath) {
  const r = await runGit(["for-each-ref", "--format=%(objectname)%09%(*objectname)%09%(refname)", "refs/heads", "refs/remotes", "refs/tags"], repoPath);
  const refs = {};
  if (r.code !== 0) return refs;
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    const [obj, peeled, full] = line.split("\t");
    const hash = peeled || obj;
    let ref = null;
    if (full.startsWith("refs/heads/")) ref = { type: "head", name: full.slice(11) };
    else if (full.startsWith("refs/remotes/")) {
      if (full.endsWith("/HEAD")) continue;
      ref = { type: "remote", name: full.slice(13) };
    } else if (full.startsWith("refs/tags/")) ref = { type: "tag", name: full.slice(10) };
    if (!ref) continue;
    (refs[hash] ||= []).push(ref);
  }
  return refs;
}

async function readHead(repoPath) {
  const [hashRes, branchRes] = await Promise.all([
    runGit(["rev-parse", "-q", "--verify", "HEAD"], repoPath),
    runGit(["symbolic-ref", "-q", "--short", "HEAD"], repoPath),
  ]);
  return {
    hash: hashRes.code === 0 ? hashRes.stdout.trim() : null,
    branch: branchRes.code === 0 ? branchRes.stdout.trim() : null,
  };
}

function parseLog(stdout) {
  return stdout.split(RECORD).map((s) => s.replace(/^\n/, "")).filter(Boolean).map((rec) => {
    const [hash, parents, author, email, time, subject] = rec.split(FIELD);
    return { hash, parents: parents ? parents.split(" ") : [], author, email, time: Number(time) * 1000, subject };
  });
}

// --numstat gives counts, --name-status gives the letter; joined by path (renames keep the new path).
function parseFiles(numstat, nameStatus) {
  const counts = new Map();
  for (const line of numstat.split("\n").filter(Boolean)) {
    const [added, deleted, ...rest] = line.split("\t");
    const file = rest[rest.length - 1];
    counts.set(file, { added: added === "-" ? null : Number(added), deleted: deleted === "-" ? null : Number(deleted) });
  }
  const files = [];
  for (const line of nameStatus.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const status = parts[0][0];
    const file = parts[parts.length - 1];
    const oldPath = parts.length > 2 ? parts[1] : null;
    const c = counts.get(file) || counts.get(`${oldPath} => ${file}`) || { added: null, deleted: null };
    files.push({ status, path: file, oldPath, added: c.added, deleted: c.deleted });
    if (files.length >= GIT_GRAPH.MAX_COMMIT_FILES) break;
  }
  return files;
}

// Base a commit is diffed against: its first parent, or the empty tree for a root commit.
async function diffBase(repoPath, hash) {
  const r = await runGit(["rev-list", "--parents", "-n", "1", hash], repoPath);
  const parent = r.code === 0 ? r.stdout.trim().split(" ")[1] : null;
  if (parent) return parent;
  const format = await runGit(["rev-parse", "--show-object-format"], repoPath);
  return EMPTY_TREE[format.stdout.trim()] || EMPTY_TREE.sha1;
}

export function setupGitGraphHandlers(socket) {
  socket.on("gitGraph", async ({ repoPath, skip = 0, limit, branch } = {}, callback) => {
    if (!repoPath || !findGitRoot(repoPath)) return callback({ success: false, error: NOT_A_REPO });
    if (branch && !isRefName(branch)) return callback({ success: false, error: "Invalid branch" });
    const pageSize = Math.min(Number.isInteger(limit) && limit > 0 ? limit : GIT_GRAPH.PAGE_SIZE, GIT_GRAPH.MAX_PAGE_SIZE);
    const from = Number.isInteger(skip) && skip > 0 ? skip : 0;
    // One extra row tells the client whether another page exists.
    const args = ["log", "--date-order", `--skip=${from}`, `-n${pageSize + 1}`,
      `--pretty=format:%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%s${RECORD}`];
    if (branch) args.push(branch, "--");
    else args.push("--branches", "--remotes", "--tags", "HEAD", "--");
    const [log, refs, head, status] = await Promise.all([
      runGit(args, repoPath),
      readRefs(repoPath),
      readHead(repoPath),
      runGit(["status", "--porcelain", "--no-renames", "-uall"], repoPath),
    ]);
    // An unborn branch has no commits — an empty graph, not an error.
    if (log.code !== 0 && head.hash) return failWith(callback, log);
    const commits = log.code === 0 ? parseLog(log.stdout) : [];
    const hasMore = commits.length > pageSize;
    callback({
      success: true,
      commits: commits.slice(0, pageSize).map((c) => ({ ...c, refs: refs[c.hash] || [] })),
      hasMore,
      head,
      uncommitted: status.code === 0 ? status.stdout.split("\n").filter(Boolean).length : 0,
    });
  });

  socket.on("gitCommitDetails", async ({ repoPath, hash } = {}, callback) => {
    if (!repoPath || !findGitRoot(repoPath)) return callback({ success: false, error: NOT_A_REPO });
    if (!isHash(hash)) return callback({ success: false, error: "Invalid commit" });
    const meta = await runGit(["show", "-s", `--format=%H${FIELD}%P${FIELD}%an${FIELD}%ae${FIELD}%at${FIELD}%cn${FIELD}%ce${FIELD}%ct${FIELD}%B`, hash], repoPath);
    if (meta.code !== 0) return failWith(callback, meta);
    const [full, parents, author, email, authorTime, committer, committerEmail, commitTime, body] = meta.stdout.split(FIELD);
    const base = await diffBase(repoPath, full);
    const [numstat, nameStatus] = await Promise.all([
      runGit(["diff", "--numstat", "-M", base, full], repoPath),
      runGit(["diff", "--name-status", "-M", base, full], repoPath),
    ]);
    callback({
      success: true,
      commit: {
        hash: full, parents: parents ? parents.split(" ") : [],
        author, email, authorTime: Number(authorTime) * 1000,
        committer, committerEmail, commitTime: Number(commitTime) * 1000,
        body: (body || "").trim(),
        files: nameStatus.code === 0 ? parseFiles(numstat.stdout, nameStatus.stdout) : [],
      },
    });
  });

  socket.on("gitCommitFileDiff", async ({ repoPath, hash, file, oldPath } = {}, callback) => {
    if (!repoPath || !findGitRoot(repoPath)) return callback({ success: false, error: NOT_A_REPO });
    if (!isHash(hash) || typeof file !== "string" || !file) return callback({ success: false, error: "Invalid request" });
    const base = await diffBase(repoPath, hash);
    const paths = oldPath && typeof oldPath === "string" ? [oldPath, file] : [file];
    const r = await runGit(["diff", "-M", base, hash, "--", ...paths], repoPath);
    if (r.code !== 0) return failWith(callback, r);
    callback({ success: true, diff: capDiff(r.stdout) });
  });

  // ---- Actions ----

  socket.on("gitGraphAction", async ({ repoPath, action, hash, ref, name, mode } = {}, callback) => {
    if (!repoPath || !findGitRoot(repoPath)) return callback({ success: false, error: NOT_A_REPO });
    let args;
    switch (action) {
      case "checkoutCommit":
        if (!isHash(hash)) return callback({ success: false, error: "Invalid commit" });
        args = ["checkout", "--detach", hash];
        break;
      case "createBranch":
        if (!isHash(hash) || !isRefName(name)) return callback({ success: false, error: "Invalid branch name" });
        args = ["branch", name, hash];
        break;
      case "createTag":
        if (!isHash(hash) || !isRefName(name)) return callback({ success: false, error: "Invalid tag name" });
        args = ["tag", name, hash];
        break;
      case "cherryPick":
        if (!isHash(hash)) return callback({ success: false, error: "Invalid commit" });
        args = ["cherry-pick", hash];
        break;
      case "revert":
        if (!isHash(hash)) return callback({ success: false, error: "Invalid commit" });
        args = ["revert", "--no-edit", hash];
        break;
      case "reset":
        if (!isHash(hash) || !["soft", "mixed", "hard"].includes(mode)) return callback({ success: false, error: "Invalid reset" });
        args = ["reset", `--${mode}`, hash];
        break;
      case "merge":
        if (!isRefName(ref)) return callback({ success: false, error: "Invalid branch" });
        args = ["merge", "--no-edit", ref];
        break;
      case "deleteBranch":
        // Safe delete only: git refuses an unmerged or checked-out branch and says why.
        if (!isRefName(ref)) return callback({ success: false, error: "Invalid branch" });
        args = ["branch", "-d", ref];
        break;
      case "deleteTag":
        if (!isRefName(ref)) return callback({ success: false, error: "Invalid tag" });
        args = ["tag", "-d", ref];
        break;
      default:
        return callback({ success: false, error: "Unknown action" });
    }
    const r = await runGit(args, repoPath);
    if (r.code !== 0) return failWith(callback, r);
    okOutput(callback, r);
  });
}
