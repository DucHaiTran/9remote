"use client";

import { memo, useState, useEffect, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight, GitBranch, Plus, Minus, Undo2, RefreshCw, ExternalLink, MoreHorizontal, ArrowUp, ArrowDown, CloudDownload, Globe, EyeOff, Folder, FolderOpen, List, ListTree } from "@/shared/components/ui/Icon";
import { vibrate } from "@/shared/utils/vibration";
import ConfirmDialog from "@/shared/components/ui/ConfirmDialog";
import FileContextMenu from "@/shared/components/ui/FileContextMenu";
import { useI18n } from "@/shared/i18n";
import useIsTouch from "@/shared/hooks/useIsTouch.js";
import { GIT_STATUS_COLORS, GIT_REFRESH_EVENT, GIT_AUTO_REFRESH_EVENTS, GIT_STATUS_DEBOUNCE_MS, SCM_RENDER_CHUNK, SCM_RENDER_STEP, SCM_VIEW_MODE_KEY, SCM_VIEW_MODES, SCM_TREE_INDENT, makeDiffPath, makeRepoDiffPath } from "../constants/fileExplorer.js";
import { resolveFileIcon } from "../constants/fileIcons.js";
import { commitSummary, pushSummary, pullSummary } from "../lib/gitOutput.js";
import GitPushDialog from "./GitPushDialog";
import GitRemotesDialog from "./GitRemotesDialog";
import { addToGitignore } from "../lib/gitignore.js";
import { splitScmFiles, buildScmTree } from "../lib/scmEntries.js";

const SECTION_STAGED = "staged";
const SECTION_CHANGES = "changes";
const SECTION_UNTRACKED = "untracked";
const ROW_PAD_LEFT = 8;

function rowIndent(depth) {
  return depth ? { paddingLeft: ROW_PAD_LEFT + depth * SCM_TREE_INDENT } : undefined;
}

function readViewMode() {
  if (typeof window === "undefined") return SCM_VIEW_MODES.LIST;
  return window.localStorage?.getItem(SCM_VIEW_MODE_KEY) === SCM_VIEW_MODES.TREE ? SCM_VIEW_MODES.TREE : SCM_VIEW_MODES.LIST;
}

function basename(p) {
  if (!p) return "";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p) {
  if (!p) return "";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

function joinPath(base, rel) {
  if (!base) return rel;
  const sep = base.endsWith("/") || base.endsWith("\\") ? "" : "/";
  return `${base}${sep}${rel}`;
}

// One changed-file row. Memoized so typing a commit message (panel-level state) does not
// re-render the whole file list per keystroke — handlers take the row's `file`, so every
// row shares one stable identity. Custom comparator: a status reload rebuilds every file
// object, so identity would defeat memo — compare the data a row actually renders.
const scmRowPropsEqual = (a, b) =>
  a.file.path === b.file.path && a.file.status === b.file.status && a.file.hasStaged === b.file.hasStaged
  && a.workspace === b.workspace && a.section === b.section && a.depth === b.depth
  && a.isTouch === b.isTouch && a.t === b.t;

// Hover actions float over the row's tail (VS Code parity): Staged rows offer Unstage,
// the others Discard + Stage. In list mode the directory follows the name; in tree mode
// the folder rows above carry it, so `depth` indents instead.
function RowActions({ isTouch, children }) {
  return (
    <div className={`absolute right-[22px] top-1/2 -translate-y-1/2 flex items-center gap-0.5 pl-2 pr-1 bg-surface-2 transition-opacity ${isTouch ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
      {children}
    </div>
  );
}

function RowButton({ title, onClick, children }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); vibrate(); onClick(); }}
      className="p-0.5 text-text-muted hover:text-text"
    >
      {children}
    </button>
  );
}

const ScmFileRow = memo(function ScmFileRow({ file, workspace, section, depth, t, isTouch, openDiff, onCtxMenu, onDiscard, onStage, onUnstage }) {
  const colorClass = GIT_STATUS_COLORS[file.status] || "text-text-muted";
  return (
    <div
      className={`group relative flex items-center gap-1.5 px-2 ${isTouch ? "py-2" : "py-1"} hover:bg-surface-2 cursor-pointer`}
      style={rowIndent(depth)}
      onContextMenu={(e) => onCtxMenu(file, e)}
      onClick={() => {
        vibrate();
        // file.path is relative to THIS repo. Where the host shows several repos side by
        // side it must travel with its repo, or the diff is read from the wrong one.
        openDiff(file);
      }}
    >
      <span className="flex-shrink-0 flex items-center">{resolveFileIcon({ name: basename(file.path), path: file.path, type: "file" }, 16)}</span>
      <span className={`truncate text-xs text-text ${depth ? "flex-1" : ""}`} title={file.path}>{basename(file.path)}</span>
      {!depth && <span className="truncate text-[11px] text-text-muted flex-1" title={dirname(file.path)}>{dirname(file.path)}</span>}
      <RowActions isTouch={isTouch}>
        {section === SECTION_STAGED ? (
          <RowButton title={t("git.unstage")} onClick={() => onUnstage([file.path])}><Minus size={12} /></RowButton>
        ) : (
          <>
            <RowButton title={section === SECTION_UNTRACKED ? t("common.delete") : t("git.discard")} onClick={() => onDiscard(file)}><Undo2 size={12} /></RowButton>
            <RowButton title={t("git.stage")} onClick={() => onStage([file.path])}><Plus size={12} /></RowButton>
          </>
        )}
      </RowActions>
      <span className={`flex-shrink-0 w-4 h-4 flex items-center justify-center text-[10px] font-mono rounded bg-surface-2 ${colorClass}`}>{file.status}</span>
    </div>
  );
}, scmRowPropsEqual);

function ScmFolderRow({ node, section, depth, open, t, isTouch, onToggle, onStage, onUnstage }) {
  return (
    <div
      className={`group relative flex items-center gap-1 px-2 ${isTouch ? "py-2" : "py-1"} hover:bg-surface-2 cursor-pointer`}
      style={rowIndent(depth)}
      onClick={() => { vibrate(); onToggle(); }}
    >
      {open ? <ChevronDown size={12} className="text-text-subtle flex-shrink-0" /> : <ChevronRight size={12} className="text-text-subtle flex-shrink-0" />}
      {open ? <FolderOpen size={14} className="text-text-muted flex-shrink-0" /> : <Folder size={14} className="text-text-muted flex-shrink-0" />}
      <span className="truncate text-xs text-text flex-1" title={node.path}>{node.name}</span>
      <RowActions isTouch={isTouch}>
        {section === SECTION_STAGED
          ? <RowButton title={t("git.unstage")} onClick={() => onUnstage(node.paths)}><Minus size={12} /></RowButton>
          : <RowButton title={t("git.stage")} onClick={() => onStage(node.paths)}><Plus size={12} /></RowButton>}
      </RowActions>
      <span className="flex-shrink-0 text-[10px] px-1 rounded-brand bg-surface-3 text-text-muted">{node.paths.length}</span>
    </div>
  );
}

// `onOpenDiff(file)`: show a diff in place (the mobile git screen) instead of opening a diff tab.
// `onChanged`: called after every status reload, so a host screen can refresh its own copy.
export default function ScmPanel({ workspace, fileBus, onOpenFile, onOpenDiff, onChanged, tagDiffWithRepo = false }) {
  const { t } = useI18n();
  const isTouch = useIsTouch();
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(null);
  const [behind, setBehind] = useState(null);
  const [files, setFiles] = useState([]);
  const [commitMsg, setCommitMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const [expandedSections, setExpandedSections] = useState(new Set([SECTION_STAGED, SECTION_CHANGES, SECTION_UNTRACKED]));
  const [viewMode, setViewMode] = useState(readViewMode);
  // Folder open/closed overrides in tree mode, keyed "<section>:<path>".
  const [dirOpen, setDirOpen] = useState({});
  // Per-section row budget — huge lists (unignored build dirs) mount one chunk, not 3k rows.
  const [visibleCounts, setVisibleCounts] = useState({});
  const [confirmAutoStageOpen, setConfirmAutoStageOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);
  const [discardTarget, setDiscardTarget] = useState(null);
  // Split-button menu (VS Code parity): the primary action commits, the arrow
  // offers the variants. `pendingPush` defers the push until the stage confirm returns.
  const [pendingPush, setPendingPush] = useState(false);
  const [commitMenu, setCommitMenu] = useState(null);
  const [moreMenu, setMoreMenu] = useState(null);

  const reload = useCallback(async () => {
    if (!workspace || !fileBus) return;
    setLoading(true);
    const [statusRes, branchRes] = await Promise.all([
      fileBus.gitStatus?.(workspace),
      fileBus.gitBranch?.(workspace)
    ]);
    setLoading(false);
    if (statusRes?.success) setFiles(statusRes.files || []);
    onChanged?.();
    if (branchRes?.success) {
      setBranch(branchRes.branch || "");
      setAhead(branchRes.ahead ?? null);
      setBehind(branchRes.behind ?? null);
    }
  }, [workspace, fileBus, onChanged]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Auto-refresh when files saved/created/deleted/renamed elsewhere — debounced so a
  // burst of watcher events costs one status spawn, not one per event.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timer = null;
    const handler = () => {
      clearTimeout(timer);
      timer = setTimeout(reload, GIT_STATUS_DEBOUNCE_MS);
    };
    GIT_AUTO_REFRESH_EVENTS.forEach(ev => window.addEventListener(ev, handler));
    return () => {
      clearTimeout(timer);
      GIT_AUTO_REFRESH_EVENTS.forEach(ev => window.removeEventListener(ev, handler));
    };
  }, [reload]);

  const { staged, changes, untracked } = useMemo(() => splitScmFiles(files), [files]);
  const trees = useMemo(() => (viewMode === SCM_VIEW_MODES.TREE
    ? { [SECTION_STAGED]: buildScmTree(staged), [SECTION_CHANGES]: buildScmTree(changes), [SECTION_UNTRACKED]: buildScmTree(untracked) }
    : null), [viewMode, staged, changes, untracked]);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === SCM_VIEW_MODES.TREE ? SCM_VIEW_MODES.LIST : SCM_VIEW_MODES.TREE;
      window.localStorage?.setItem(SCM_VIEW_MODE_KEY, next);
      return next;
    });
  }, []);

  const toggleSection = useCallback((id) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const stagePaths = useCallback(async (paths) => {
    if (!workspace || !paths.length) return;
    const res = await fileBus.gitAdd?.(workspace, paths);
    if (res && !res.success) setResult({ ok: false, text: res.error || t("git.stageFailed") });
    reload();
  }, [workspace, fileBus, reload, t]);

  const unstagePaths = useCallback(async (paths) => {
    if (!workspace || !paths.length) return;
    const res = await fileBus.gitReset?.(workspace, paths);
    if (res && !res.success) setResult({ ok: false, text: res.error });
    reload();
  }, [workspace, fileBus, reload]);

  const stageAll = useCallback(async () => {
    if (!workspace) return;
    await fileBus.gitAdd?.(workspace, ["."]);
    reload();
  }, [workspace, fileBus, reload]);

  const discardFile = useCallback(async (file) => {
    if (!workspace) return;
    // A file with staged edits keeps them: only its working-copy changes are dropped.
    await fileBus.gitDiscard?.(workspace, file.path, file.status, { keepStaged: file.hasStaged });
    reload();
  }, [workspace, fileBus, reload]);

  const requestDiscard = useCallback((file) => {
    setDiscardTarget(file);
    setConfirmDiscardOpen(true);
  }, []);

  const openDiff = useCallback((file) => {
    if (onOpenDiff) return onOpenDiff(file);
    onOpenFile?.(tagDiffWithRepo
      ? makeRepoDiffPath(file.status, workspace, file.path)
      : makeDiffPath(file.status, file.path));
  }, [onOpenFile, onOpenDiff, tagDiffWithRepo, workspace]);

  // Commits what is staged; with nothing staged it offers to stage everything first.
  const commit = useCallback(async ({ stageAll: addAll, withPush }) => {
    if (!workspace) return;
    setResult(null);
    if (addAll) {
      const add = await fileBus.gitAdd?.(workspace, ["."]);
      if (add && !add.success) {
        setResult({ ok: false, text: add.error || t("git.stageFailed") });
        return;
      }
    }
    const res = await fileBus.gitCommit?.(workspace, commitMsg.trim());
    if (!res?.success) {
      setResult({ ok: false, text: res?.output || res?.error || t("git.commitFailed") });
      reload();
      return;
    }
    setCommitMsg("");
    if (!withPush) {
      setResult({ ok: true, text: commitSummary(t, res.output) });
      reload();
      return;
    }
    const pushed = await fileBus.gitPush?.(workspace);
    setResult(pushed?.success
      ? { ok: true, text: `${commitSummary(t, res.output)} · ${pushSummary(t, pushed.output)}` }
      : { ok: false, text: pushed?.output || pushed?.error || t("git.pushFailed") });
    reload();
  }, [workspace, fileBus, commitMsg, reload, t]);

  const handleCommitClick = useCallback((withPush = false) => {
    if (!commitMsg.trim()) return;
    if (!files.length) return;
    if (staged.length) {
      commit({ stageAll: false, withPush });
      return;
    }
    setPendingPush(withPush);
    setConfirmAutoStageOpen(true);
  }, [commitMsg, files, staged, commit]);

  const [pushDialog, setPushDialog] = useState(null); // { upstreamDefault } while open
  const [remotesOpen, setRemotesOpen] = useState(false);

  const handlePush = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setResult(null);
    const res = await fileBus.gitPush?.(workspace);
    setLoading(false);
    // A branch with no upstream yet: ask where to push it instead of only showing git's refusal.
    const text = `${res?.output || ""}\n${res?.error || ""}`;
    if (!res?.success && branch && /no upstream branch|has no upstream|No configured push destination/i.test(text)) {
      setPushDialog({ upstreamDefault: true });
      return;
    }
    setResult(res?.success
      ? { ok: true, text: pushSummary(t, res.output) }
      : { ok: false, text: res?.output || res?.error || t("git.pushFailed") });
    reload();
  }, [workspace, fileBus, reload, t, branch]);

  const handlePull = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setResult(null);
    const res = await fileBus.gitPull?.(workspace);
    setLoading(false);
    setResult(res?.success
      ? { ok: true, text: pullSummary(t, res.output) }
      : { ok: false, text: res?.output || res?.error || t("git.pullFailed") });
    reload();
  }, [workspace, fileBus, reload, t]);


  const handleFetch = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    setResult(null);
    const res = await fileBus.gitFetch?.(workspace);
    setLoading(false);
    setResult(res?.success
      ? { ok: true, text: res.output || t("git.fetchDone") }
      : { ok: false, text: res?.output || res?.error || t("git.fetchFailed") });
    window.dispatchEvent(new Event(GIT_REFRESH_EVENT));
  }, [workspace, fileBus, t]);

  const anchorMenu = useCallback((e, set) => {
    e.stopPropagation();
    vibrate();
    const r = e.currentTarget.getBoundingClientRect();
    set({ x: r.right, y: r.bottom + 4 });
  }, []);

  // Right-click context menu (vscode-style)
  const [ctxMenu, setCtxMenu] = useState(null);
  const copyToClipboard = useCallback(async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  }, []);
  const openCtxMenu = useCallback((file, e) => {
    e.preventDefault();
    e.stopPropagation();
    vibrate();
    setCtxMenu({ file, x: e.clientX, y: e.clientY });
  }, []);
  const handleAddToGitignore = useCallback(async (file) => {
    if (!workspace || !fileBus || !file?.path) return;
    const res = await addToGitignore(fileBus, workspace, file.path);
    if (res?.success) {
      window.dispatchEvent(new CustomEvent(GIT_REFRESH_EVENT));
      reload();
    }
  }, [workspace, fileBus, reload]);

  const buildMenuItems = useCallback((file) => {
    const absPath = joinPath(workspace, file.path);
    return [
      { key: "open", label: t("git.openFile"), icon: ExternalLink, disabled: file.status === "D",
        onClick: () => onOpenFile?.(absPath) },
      { key: "copyPath", label: t("files.copyPath", { defaultValue: "Copy Path" }), icon: ExternalLink, onClick: () => copyToClipboard(absPath) },
      { key: "copyRel", label: t("files.copyRelPath", { defaultValue: "Copy Relative Path" }), icon: ExternalLink, onClick: () => copyToClipboard(file.path) },
      { key: "copyName", label: t("files.copyName", { defaultValue: "Copy Filename" }), icon: ExternalLink, onClick: () => copyToClipboard(basename(file.path)) },
      { key: "addToGitignore", label: t("git.addToGitignore", { defaultValue: "Add to .gitignore" }), icon: EyeOff, onClick: () => handleAddToGitignore(file) },
    ];
  }, [workspace, onOpenFile, copyToClipboard, handleAddToGitignore, t]);

  const renderFileRow = (file, section, depth = 0) => (
    <ScmFileRow
      key={`${section}-${file.path}`}
      file={file}
      workspace={workspace}
      section={section}
      depth={depth}
      t={t}
      isTouch={isTouch}
      openDiff={openDiff}
      onCtxMenu={openCtxMenu}
      onDiscard={requestDiscard}
      onStage={stagePaths}
      onUnstage={unstagePaths}
    />
  );

  const showMore = useCallback((id) => {
    setVisibleCounts((prev) => ({ ...prev, [id]: (prev[id] ?? SCM_RENDER_CHUNK) + SCM_RENDER_STEP }));
  }, []);

  // Huge sections (an unignored build dir) start with folders closed so they mount a few rows.
  const renderTree = (nodes, section, depth, startOpen) => nodes.map((node) => {
    if (node.type === "file") return renderFileRow(node.entry, section, depth);
    const key = `${section}:${node.path}`;
    const open = dirOpen[key] ?? startOpen;
    return (
      <div key={key}>
        <ScmFolderRow
          node={node}
          section={section}
          depth={depth}
          open={open}
          t={t}
          isTouch={isTouch}
          onToggle={() => setDirOpen((prev) => ({ ...prev, [key]: !open }))}
          onStage={stagePaths}
          onUnstage={unstagePaths}
        />
        {open && renderTree(node.children, section, depth + 1, startOpen)}
      </div>
    );
  });

  const renderSection = (id, label, list) => {
    if (id === SECTION_STAGED && !list.length) return null;
    const expanded = expandedSections.has(id);
    const visible = list.slice(0, visibleCounts[id] ?? SCM_RENDER_CHUNK);
    const remaining = list.length - visible.length;
    const paths = list.map((f) => f.path);
    return (
      <div className="border-t border-border">
        <div
          onClick={() => { vibrate(); toggleSection(id); }}
          className="group relative w-full flex items-center gap-1 px-2 py-1 hover:bg-surface-2 text-left cursor-pointer"
        >
          {expanded ? <ChevronDown size={12} className="text-text-subtle" /> : <ChevronRight size={12} className="text-text-subtle" />}
          <span className="text-[11px] uppercase tracking-wider text-text-muted flex-1">{label}</span>
          {list.length > 0 && (
            <span className={`flex items-center transition-opacity ${isTouch ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              {id === SECTION_STAGED
                ? <RowButton title={t("git.unstageAll")} onClick={() => unstagePaths(paths)}><Minus size={12} /></RowButton>
                : <RowButton title={t("git.stageAll")} onClick={() => stagePaths(paths)}><Plus size={12} /></RowButton>}
            </span>
          )}
          <span className="text-[10px] px-1.5 rounded-brand bg-surface-3 text-text-muted">{list.length}</span>
        </div>
        {expanded && (trees ? renderTree(trees[id], id, 1, list.length <= SCM_RENDER_CHUNK) : (
          <>
            {visible.map((f) => renderFileRow(f, id))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => { vibrate(); showMore(id); }}
                className="w-full px-2 py-1 text-[11px] text-brand-500 hover:bg-surface-2 text-left"
              >
                {t("git.showMore", { count: remaining })}
              </button>
            )}
          </>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full text-sm text-text">
      <div className="px-3 pt-3 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-text-muted" />
          <span className="text-xs text-text truncate flex-1">{branch || "—"}</span>
          {ahead > 0 && <span className="text-[10px] font-medium px-1.5 rounded-brand bg-brand-500/15 text-brand-500">↑{ahead}</span>}
          {behind > 0 && <span className="text-[10px] font-medium px-1.5 rounded-brand bg-surface-3 text-text-muted">↓{behind}</span>}
          <button
            type="button"
            title={viewMode === SCM_VIEW_MODES.TREE ? t("git.viewAsList") : t("git.viewAsTree")}
            onClick={() => { vibrate(); toggleViewMode(); }}
            className="p-1 text-text-muted hover:text-text"
          >
            {viewMode === SCM_VIEW_MODES.TREE ? <List size={12} /> : <ListTree size={12} />}
          </button>
          <button
            type="button"
            title={t("git.fetch")}
            disabled={loading}
            onClick={() => { vibrate(); handleFetch(); }}
            className="p-1 text-text-muted hover:text-text disabled:opacity-40"
          >
            <CloudDownload size={12} />
          </button>
          <button
            type="button"
            title={t("common.refresh")}
            // Broadcast instead of calling reload() directly: the listener above reloads
            // this list and every open diff tab refetches too.
            onClick={() => { vibrate(); window.dispatchEvent(new Event(GIT_REFRESH_EVENT)); }}
            className="p-1 text-text-muted hover:text-text"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            title={t("git.gitActions")}
            onClick={(e) => anchorMenu(e, setMoreMenu)}
            className="p-1 text-text-muted hover:text-text"
          >
            <MoreHorizontal size={12} />
          </button>
        </div>

        <textarea
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          rows={2}
          placeholder={t("git.commitPlaceholder")}
          className="w-full bg-surface-2 border border-border rounded-brand px-2 py-1 text-xs text-text placeholder-text-subtle focus:outline-none focus:border-brand-500 resize-none"
        />

        {/* VS Code parity: one primary Commit split-button; every other git action
            lives behind the arrow or the "…" in the branch row. */}
        <div className={`flex items-stretch h-7 rounded-brand overflow-hidden bg-brand-500 text-white transition-opacity ${
          !commitMsg.trim() || !files.length ? "opacity-40" : ""
        }`}>
          <button
            type="button"
            disabled={!commitMsg.trim() || !files.length}
            onClick={() => { vibrate(); handleCommitClick(false); }}
            className="flex-1 text-xs hover:bg-black/10 disabled:cursor-not-allowed transition-colors"
          >
            {t("git.commit")}
          </button>
          <span className="w-px my-1.5 bg-white/25" />
          <button
            type="button"
            title={t("git.gitActions")}
            disabled={!commitMsg.trim() || !files.length}
            onClick={(e) => anchorMenu(e, setCommitMenu)}
            className="px-1.5 flex items-center hover:bg-black/10 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronDown size={12} />
          </button>
        </div>

        {result && (
          <div className={`text-[11px] leading-snug break-words rounded-brand px-2 py-1 ${
            result.ok
              ? "text-[var(--success)] bg-[rgba(var(--success-rgb),0.1)]"
              : "text-[var(--danger)] bg-[rgba(var(--danger-rgb),0.1)]"
          }`}>
            {result.text}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {renderSection(SECTION_STAGED, t("git.staged"), staged)}
        {renderSection(SECTION_CHANGES, t("git.changes"), changes)}
        {renderSection(SECTION_UNTRACKED, t("git.untracked"), untracked)}
      </div>

      <ConfirmDialog
        isOpen={confirmAutoStageOpen}
        onClose={() => setConfirmAutoStageOpen(false)}
        onConfirm={() => commit({ stageAll: true, withPush: pendingPush })}
        title={t("git.stageAllConfirmTitle")}
        message={t("git.stageAllConfirmMessage")}
        confirmText={t("git.stageAndCommit")}
        cancelText={t("common.cancel")}
      />

      <ConfirmDialog
        isOpen={confirmDiscardOpen}
        onClose={() => { setConfirmDiscardOpen(false); setDiscardTarget(null); }}
        onConfirm={() => { if (discardTarget) discardFile(discardTarget); setDiscardTarget(null); }}
        title={t("git.discardConfirmTitle")}
        message={discardTarget
          ? (discardTarget.status === "?"
            ? t("git.discardConfirmDelete", { name: basename(discardTarget.path) })
            : t("git.discardConfirmDiscard", { name: basename(discardTarget.path) }))
          : ""}
        confirmText={t("git.discard")}
        cancelText={t("common.cancel")}
      />

      {ctxMenu && (
        <FileContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={buildMenuItems(ctxMenu.file)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {commitMenu && (
        <FileContextMenu
          x={commitMenu.x}
          y={commitMenu.y}
          items={[
            { key: "commitPush", label: t("git.commitAndPush"), icon: ArrowUp,
              disabled: !commitMsg.trim() || !files.length,
              onClick: () => handleCommitClick(true) }
          ]}
          onClose={() => setCommitMenu(null)}
        />
      )}

      {moreMenu && (
        <FileContextMenu
          x={moreMenu.x}
          y={moreMenu.y}
          items={[
            { key: "push", label: t("git.push"), icon: ArrowUp, onClick: handlePush },
            { key: "pushTo", label: t("git.pushTo"), icon: ArrowUp, disabled: !branch, onClick: () => setPushDialog({ upstreamDefault: false }) },
            { key: "fetch", label: t("git.fetch"), icon: CloudDownload, onClick: handleFetch },
            { key: "pull", label: t("git.pull"), icon: ArrowDown, onClick: handlePull },
            { key: "stageAll", label: t("git.stageAll"), icon: Plus, disabled: !files.length, onClick: stageAll },
            { key: "remotes", label: t("git.manageRemotes"), icon: Globe, onClick: () => setRemotesOpen(true) }
          ]}
          onClose={() => setMoreMenu(null)}
        />
      )}
      {pushDialog && branch && (
        <GitPushDialog
          workspace={workspace}
          fileBus={fileBus}
          source={branch}
          label={branch}
          branch={branch}
          upstreamDefault={pushDialog.upstreamDefault}
          onClose={() => setPushDialog(null)}
          onPushed={(text) => { setResult({ ok: true, text }); reload(); }}
        />
      )}
      {remotesOpen && <GitRemotesDialog workspace={workspace} fileBus={fileBus} onClose={() => setRemotesOpen(false)} />}
    </div>
  );
}
