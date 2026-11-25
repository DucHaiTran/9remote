"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2, CloudDownload, ArrowUp } from "@/shared/components/ui/Icon";
import ConfirmDialog from "@/shared/components/ui/ConfirmDialog";
import PromptDialog from "@/shared/components/ui/PromptDialog";
import FileContextMenu, { FILE_MENU_ICONS } from "@/shared/components/ui/FileContextMenu";
import { vibrate } from "@/shared/utils/vibration";
import { formatRelativeTime } from "@/shared/utils/formatters";
import { useI18n } from "@/shared/i18n";
import { GIT_GRAPH_UI, GIT_REFRESH_EVENT } from "../constants/fileExplorer.js";
import { layoutGraph, UNCOMMITTED_HASH } from "../lib/gitGraphLayout.js";
import GitCommitDetails from "./GitCommitDetails.js";
import GitPushDialog from "./GitPushDialog";
import { readGraphCache, writeGraphCache } from "../lib/gitGraphCache.js";
import { useBackClose } from "@/shared/hooks/useBackClose";

const { ROW_HEIGHT: H, NODE_RADIUS: R, COLORS } = GIT_GRAPH_UI;
const MID = H / 2;
const short = (hash) => hash.slice(0, GIT_GRAPH_UI.SHORT_HASH);
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});
// What a refresh compares: same signature means nothing visible changed, so the rows stay put.
const signatureOf = ({ commits, head, uncommitted, hasMore }) =>
  `${head?.hash}|${head?.branch}|${uncommitted}|${hasMore}|${commits.map((c) => `${c.hash}:${c.refs.map((r) => r.name).join(",")}`).join(";")}`;

// Lanes keep their full width while they fit the column, then squeeze down to the minimum.
const laneWidthFor = (lanes) => Math.max(GIT_GRAPH_UI.MIN_LANE_WIDTH, Math.min(GIT_GRAPH_UI.LANE_WIDTH, GIT_GRAPH_UI.GRAPH_MAX_WIDTH / lanes));

function GraphCell({ row, width, laneWidth: W, dashed }) {
  const laneX = (i) => i * W + W / 2;
  const curve = (a, b, y0, y1) => {
    const xa = laneX(a), xb = laneX(b), ym = (y0 + y1) / 2;
    return a === b ? `M${xa} ${y0}V${y1}` : `M${xa} ${y0}C${xa} ${ym} ${xb} ${ym} ${xb} ${y1}`;
  };
  const r = Math.min(R, W / 2 - 1);
  return (
    <svg width={width * W} height={H} className="flex-shrink-0 block" aria-hidden="true">
      {row.top.map(([a, b, c], i) => <path key={`t${i}`} d={curve(a, b, 0, MID)} stroke={COLORS[c]} strokeWidth="2" fill="none" />)}
      {row.bottom.map(([a, b, c], i) => (
        <path key={`b${i}`} d={curve(a, b, MID, H)} stroke={COLORS[c]} strokeWidth="2" fill="none" strokeDasharray={dashed && a === row.col ? "3 3" : undefined} />
      ))}
      <circle cx={laneX(row.col)} cy={MID} r={r} fill={dashed ? "var(--bg)" : COLORS[row.color]} stroke={COLORS[row.color]} strokeWidth="2" />
    </svg>
  );
}

const REF_STYLE = {
  head: "border-brand-500/50 text-brand-500 bg-brand-500/10",
  // A step below a local branch (no brand colour), above the grey hash/author/date line.
  remote: "border-sky-500/40 text-sky-500 bg-sky-500/10",
  tag: "border-amber-500/50 text-amber-500 bg-amber-500/10",
};

function RefBadge({ refInfo, current }) {
  return (
    <span className={`inline-flex items-center max-w-[8rem] min-w-[2.5rem] px-1.5 h-[18px] rounded border text-[10px] leading-none font-medium shrink ${REF_STYLE[refInfo.type]} ${current ? "ring-1 ring-brand-500" : ""}`}>
      <span className="truncate">{refInfo.type === "tag" ? `🏷 ${refInfo.name}` : refInfo.name}</span>
    </span>
  );
}

// Git Graph-style history: every branch as lanes, refs on their commits, a commit opens its
// details. Long-press (context menu) a row for the commit and branch actions.
export default function GitGraphView({ workspace, fileBus, onShowChanges, onChanged }) {
  const { t } = useI18n();
  // Reopening the last repo's graph starts from its cached view, then refreshes silently.
  const [cached] = useState(() => readGraphCache(workspace));
  const [commits, setCommits] = useState(cached?.commits || []);
  const [head, setHead] = useState(cached?.head || { hash: null, branch: null });
  const [uncommitted, setUncommitted] = useState(cached?.uncommitted || 0);
  const [hasMore, setHasMore] = useState(cached?.hasMore || false);
  const [loading, setLoading] = useState(!cached?.commits);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null); // { ok, text }
  const [pushing, setPushing] = useState(null); // { source, label, branch } while the push dialog is open
  const [branchFilter, setBranchFilter] = useState(cached?.branchFilter || "");
  const [branches, setBranches] = useState(cached?.branches || []);
  const [selected, setSelected] = useState(cached?.selected || null);
  useBackClose(() => setSelected(null), !!selected);
  const sigRef = useRef(cached?.commits ? signatureOf(cached) : null);
  const countRef = useRef(commits.length);
  useEffect(() => { countRef.current = commits.length; }, [commits.length]);
  const [menu, setMenu] = useState(null); // { hash, x, y }
  const [confirm, setConfirm] = useState({ isOpen: false });
  const [prompt, setPrompt] = useState(null); // { title, value, onSubmit }

  // Bumping the tick re-reads the first page; the spinner is raised only by a filter change, so a reload after an action keeps the rows.
  const [reloadTick, setReloadTick] = useState(0);
  const load = useCallback(() => setReloadTick((n) => n + 1), []);
  useEffect(() => {
    let live = true;
    // Re-read as many commits as are on screen, so a refresh never drops pages the user loaded.
    const limit = Math.min(GIT_GRAPH_UI.MAX_PAGE_SIZE, Math.max(GIT_GRAPH_UI.PAGE_SIZE, countRef.current));
    fileBus.gitGraph(workspace, { limit, branch: branchFilter || undefined }).then((r) => {
      if (!live) return;
      setLoading(false);
      if (!r.success) { setError(r.error); return; }
      setError("");
      const sig = signatureOf(r);
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      setCommits(r.commits); setHasMore(r.hasMore); setHead(r.head); setUncommitted(r.uncommitted);
    });
    return () => { live = false; };
  }, [workspace, fileBus, branchFilter, reloadTick]);

  const loadMore = useCallback(async () => {
    vibrate(); setLoadingMore(true);
    const r = await fileBus.gitGraph(workspace, { skip: commits.length, limit: GIT_GRAPH_UI.PAGE_SIZE, branch: branchFilter || undefined });
    setLoadingMore(false);
    if (!r.success) { setError(r.error); return; }
    setCommits((prev) => [...prev, ...r.commits]); setHasMore(r.hasMore);
  }, [workspace, fileBus, branchFilter, commits.length]);

  useEffect(() => {
    if (loading) return;
    writeGraphCache(workspace, { commits, head, uncommitted, hasMore, branchFilter, branches, selected });
  }, [workspace, loading, commits, head, uncommitted, hasMore, branchFilter, branches, selected]);

  // The list's scroll position survives tab switches and the trip into a commit's details.
  const listRef = useCallback((el) => {
    if (el) el.scrollTo({ top: readGraphCache(workspace)?.scrollTop || 0, behavior: "instant" });
  }, [workspace]);
  const onListScroll = useCallback((e) => writeGraphCache(workspace, { scrollTop: e.currentTarget.scrollTop }), [workspace]);

  useEffect(() => {
    fileBus.gitBranchList(workspace).then((r) => { if (r?.success) setBranches(r.branches); });
  }, [workspace, fileBus]);

  // The uncommitted row hangs off HEAD, so it is only drawn when HEAD is in the loaded page.
  const rowsSource = useMemo(() => {
    const showWip = uncommitted > 0 && head.hash && commits.some((c) => c.hash === head.hash);
    return showWip ? [{ hash: UNCOMMITTED_HASH, parents: [head.hash] }, ...commits] : commits;
  }, [commits, uncommitted, head.hash]);
  const layout = useMemo(() => layoutGraph(rowsSource, COLORS.length), [rowsSource]);
  const laneWidth = laneWidthFor(layout.width);
  const byHash = useMemo(() => new Map(commits.map((c) => [c.hash, c])), [commits]);

  const run = useCallback(async (action, params, successText) => {
    const r = await fileBus.gitGraphAction(workspace, action, params);
    setNotice({ ok: r.success, text: r.success ? (successText || r.output || t("common.done")) : r.error });
    if (r.success) {
      window.dispatchEvent(new CustomEvent(GIT_REFRESH_EVENT));
      onChanged?.();
      load();
    }
  }, [fileBus, workspace, load, onChanged, t]);

  const [fetching, setFetching] = useState(false);
  // Fetch brings in remote branches and commits; the graph then re-reads to show them.
  const fetchRemotes = useCallback(async () => {
    setFetching(true);
    const r = await fileBus.gitFetch(workspace);
    setFetching(false);
    setNotice({ ok: r.success, text: r.success ? (r.output || t("git.fetchDone")) : (r.output || r.error || t("git.fetchFailed")) });
    if (!r.success) return;
    window.dispatchEvent(new CustomEvent(GIT_REFRESH_EVENT));
    fileBus.gitBranchList(workspace).then((b) => { if (b?.success) setBranches(b.branches); });
    load();
  }, [fileBus, workspace, load, t]);

  const ask = (title, message, onConfirm) => setConfirm({ isOpen: true, title, message, onConfirm });
  const askName = (title, onSubmit) => setPrompt({ title, value: "", onSubmit });

  const checkoutBranch = useCallback(async (name, remote) => {
    // A remote branch checks out by its short name: git switches to the local branch or creates one tracking it.
    const local = remote ? name.slice(name.indexOf("/") + 1) : name;
    const r = await fileBus.gitBranchCheckout(workspace, local, false);
    setNotice({ ok: r.success, text: r.success ? t("git.switchedTo", { name: local }) : r.error });
    if (r.success) { window.dispatchEvent(new CustomEvent(GIT_REFRESH_EVENT)); onChanged?.(); load(); }
  }, [fileBus, workspace, load, onChanged, t]);

  const menuItems = useCallback((hash) => {
    const c = byHash.get(hash);
    if (!c) return [];
    const I = FILE_MENU_ICONS;
    const items = [
      { key: "copyHash", label: t("git.copyHash"), icon: I.Copy, onClick: () => copy(c.hash) },
      { key: "copySubject", label: t("git.copySubject"), icon: I.FileText, onClick: () => copy(c.subject) },
    ];
    for (const ref of c.refs) {
      if (ref.type === "head") {
        items.push({ key: `push:${ref.name}`, label: t("git.pushBranch", { name: ref.name }), icon: ArrowUp,
          onClick: () => setPushing({ source: ref.name, label: ref.name, branch: ref.name }) });
      }
      if (ref.type === "head" && ref.name !== head.branch) {
        items.push({ key: `co:${ref.name}`, label: t("git.checkoutBranch", { name: ref.name }), icon: I.ExternalLink, onClick: () => checkoutBranch(ref.name, false) });
        if (head.branch) items.push({ key: `mg:${ref.name}`, label: t("git.mergeInto", { name: ref.name, current: head.branch }), icon: I.ExternalLink,
          onClick: () => ask(t("git.merge"), t("git.mergeConfirm", { name: ref.name, current: head.branch }), () => run("merge", { ref: ref.name })) });
        items.push({ key: `del:${ref.name}`, label: t("git.deleteBranch", { name: ref.name }), icon: I.X, danger: true,
          onClick: () => ask(t("git.deleteBranchTitle"), t("git.deleteBranchConfirm", { name: ref.name }), () => run("deleteBranch", { ref: ref.name })) });
      }
      if (ref.type === "remote") {
        items.push({ key: `co:${ref.name}`, label: t("git.checkoutBranch", { name: ref.name }), icon: I.ExternalLink, onClick: () => checkoutBranch(ref.name, true) });
      }
      if (ref.type === "tag") {
        items.push({ key: `dt:${ref.name}`, label: t("git.deleteTag", { name: ref.name }), icon: I.X, danger: true,
          onClick: () => ask(t("git.deleteTagTitle"), t("git.deleteTagConfirm", { name: ref.name }), () => run("deleteTag", { ref: ref.name })) });
      }
    }
    items.push(
      { key: "pushCommit", label: t("git.pushCommit"), icon: ArrowUp,
        onClick: () => setPushing({ source: c.hash, label: short(c.hash), branch: head.branch || "" }) },
      { key: "branch", label: t("git.createBranchHere"), icon: I.FileText, onClick: () => askName(t("git.createBranchHere"), (name) => run("createBranch", { hash: c.hash, name }, t("git.branchCreated", { name }))) },
      { key: "tag", label: t("git.createTagHere"), icon: I.FileText, onClick: () => askName(t("git.createTagHere"), (name) => run("createTag", { hash: c.hash, name }, t("git.tagCreated", { name }))) },
      { key: "checkout", label: t("git.checkoutCommit"), icon: I.ExternalLink,
        onClick: () => ask(t("git.checkoutCommit"), t("git.checkoutCommitConfirm", { hash: short(c.hash) }), () => run("checkoutCommit", { hash: c.hash })) },
      { key: "cherry", label: t("git.cherryPick"), icon: I.Undo2, disabled: c.hash === head.hash,
        onClick: () => ask(t("git.cherryPick"), t("git.cherryPickConfirm", { hash: short(c.hash) }), () => run("cherryPick", { hash: c.hash })) },
      { key: "revert", label: t("git.revert"), icon: I.Undo2,
        onClick: () => ask(t("git.revert"), t("git.revertConfirm", { hash: short(c.hash) }), () => run("revert", { hash: c.hash })) },
    );
    for (const mode of ["soft", "mixed", "hard"]) {
      items.push({ key: `reset:${mode}`, label: t(`git.reset_${mode}`), icon: I.Undo2, danger: mode === "hard", disabled: c.hash === head.hash,
        onClick: () => ask(t("git.resetTitle"), t(mode === "hard" ? "git.resetHardConfirm" : "git.resetConfirm", { branch: head.branch || "HEAD", hash: short(c.hash) }), () => run("reset", { hash: c.hash, mode })) });
    }
    return items;
  }, [byHash, head, t, run, checkoutBranch]);

  const openMenu = useCallback((hash, e) => {
    e.preventDefault?.(); e.stopPropagation?.();
    if (hash === UNCOMMITTED_HASH) return;
    vibrate();
    setMenu({ hash, x: e.clientX, y: e.clientY });
  }, []);

  const dialogs = (
    <>
      {menu && <FileContextMenu x={menu.x} y={menu.y} items={menuItems(menu.hash)} onClose={() => setMenu(null)} />}
      {pushing && (
        <GitPushDialog
          workspace={workspace}
          fileBus={fileBus}
          source={pushing.source}
          label={pushing.label}
          branch={pushing.branch}
          onClose={() => setPushing(null)}
          onPushed={(text) => { setNotice({ ok: true, text }); window.dispatchEvent(new CustomEvent(GIT_REFRESH_EVENT)); load(); }}
        />
      )}
      <ConfirmDialog isOpen={confirm.isOpen} onClose={() => setConfirm({ isOpen: false })} onConfirm={confirm.onConfirm} title={confirm.title} message={confirm.message} />
      {prompt && (
        <PromptDialog
          title={prompt.title}
          value={prompt.value}
          placeholder={t("git.refNamePlaceholder")}
          onChange={(value) => setPrompt({ ...prompt, value })}
          onSubmit={() => { const name = prompt.value.trim(); if (name) prompt.onSubmit(name); setPrompt(null); }}
          onClose={() => setPrompt(null)}
        />
      )}
    </>
  );

  const noticeBar = notice && (
    <button onClick={() => setNotice(null)} className={`w-full text-left px-4 py-2 text-xs border-b whitespace-pre-wrap break-words ${notice.ok ? "bg-[rgba(var(--success-rgb),0.12)] text-[var(--success)] border-border" : "bg-red-500/15 text-red-400 border-red-500/40"}`}>
      {notice.text}
    </button>
  );

  if (selected) {
    return (
      <div className="h-full flex flex-col min-h-0">
        {noticeBar}
        <div className="flex-1 min-h-0">
          <GitCommitDetails key={selected} workspace={workspace} fileBus={fileBus} hash={selected} onBack={() => setSelected(null)} onSelectCommit={setSelected} onOpenMenu={openMenu} />
        </div>
        {dialogs}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
        <select
          value={branchFilter}
          onChange={(e) => { vibrate(); setLoading(true); countRef.current = 0; sigRef.current = null; writeGraphCache(workspace, { scrollTop: 0 }); setBranchFilter(e.target.value); }}
          className="flex-1 min-w-0 px-2 py-1.5 bg-surface-2 rounded-brand text-sm text-text focus:outline-none"
        >
          <option value="">{t("git.allBranches")}</option>
          {branches.map((b) => <option key={b.name} value={b.name}>{b.isCurrent ? `● ${b.name}` : b.name}</option>)}
        </select>
        <span className="text-xs text-text-muted flex-shrink-0">{t("git.commitCount", { count: commits.length })}{hasMore ? "+" : ""}</span>
        <button
          type="button"
          title={t("git.fetch")}
          disabled={fetching}
          onClick={() => { vibrate(); fetchRemotes(); }}
          className="p-1.5 rounded-brand text-text-muted hover:text-text hover:bg-surface-2 disabled:opacity-40 flex-shrink-0"
        >
          {fetching ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
        </button>
      </div>
      {noticeBar}
      {error && <div className="px-4 py-2 text-sm text-red-400 border-b border-red-500/40 bg-red-500/15">{error}</div>}
      <div ref={listRef} onScroll={onListScroll} className="flex-1 overflow-y-auto overflow-x-hidden modal-scrollable">
        {loading ? (
          <div className="flex justify-center py-10 text-text-muted"><Loader2 size={20} className="animate-spin" /></div>
        ) : rowsSource.length === 0 ? (
          <div className="text-center text-text-muted py-8">{t("git.noCommits")}</div>
        ) : (
          <>
            {rowsSource.map((c, i) => {
              const row = layout.rows[i];
              const wip = c.hash === UNCOMMITTED_HASH;
              const isHead = c.hash === head.hash;
              return (
                <div
                  key={c.hash}
                  role="button"
                  tabIndex={0}
                  onClick={() => { vibrate(); wip ? onShowChanges?.() : setSelected(c.hash); }}
                  onContextMenu={(e) => openMenu(c.hash, e)}
                  className="flex items-stretch pl-1 pr-3 hover:bg-surface-2 active:bg-surface-2 cursor-pointer select-none"
                  style={{ height: H }}
                >
                  <div className="overflow-hidden flex-shrink-0" style={{ width: Math.min(layout.width * laneWidth, GIT_GRAPH_UI.GRAPH_MAX_WIDTH) }}>
                    <GraphCell row={row} width={layout.width} laneWidth={laneWidth} dashed={wip} />
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center pl-1.5">
                    <div className="flex items-center gap-1 min-w-0">
                      {!wip && c.refs.map((ref) => <RefBadge key={`${ref.type}:${ref.name}`} refInfo={ref} current={ref.type === "head" && ref.name === head.branch} />)}
                      {isHead && !head.branch && <RefBadge refInfo={{ type: "head", name: "HEAD" }} current />}
                      <span className={`truncate text-sm flex-1 min-w-[40%] ${wip ? "italic text-text-muted" : "text-text"} ${isHead ? "font-semibold" : ""}`}>
                        {wip ? t("git.uncommittedChanges", { count: uncommitted }) : c.subject}
                      </span>
                    </div>
                    {!wip && (
                      <div className="text-[11px] text-text-muted truncate">
                        <span className="font-mono">{short(c.hash)}</span> · {c.author} · {formatRelativeTime(c.time)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {hasMore && (
              <div className="p-3">
                <button onClick={loadMore} disabled={loadingMore} className="w-full py-2 rounded-brand bg-surface-2 hover:bg-surface-3 text-sm text-text flex items-center justify-center gap-2">
                  {loadingMore && <Loader2 size={14} className="animate-spin" />}
                  {t("git.loadMore")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {dialogs}
    </div>
  );
}
