"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, Copy, MoreVertical, Loader2 } from "@/shared/components/ui/Icon";
import { vibrate } from "@/shared/utils/vibration";
import { useI18n } from "@/shared/i18n";
import { resolveFileIcon } from "../constants/fileIcons.js";
import { GIT_STATUS_COLORS, GIT_GRAPH_UI } from "../constants/fileExplorer.js";
import DiffBody from "./DiffBody.js";

const short = (hash) => hash.slice(0, GIT_GRAPH_UI.SHORT_HASH);
const copy = (text) => navigator.clipboard?.writeText(text).catch(() => {});

// One commit: message, people, parents and the files it touched; a file opens its diff.
export default function GitCommitDetails({ workspace, fileBus, hash, onBack, onSelectCommit, onOpenMenu }) {
  const { t } = useI18n();
  const [commit, setCommit] = useState(null);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [diff, setDiff] = useState(null);

  // Mounted per commit (keyed by hash), so state starts empty for each one.
  useEffect(() => {
    let live = true;
    fileBus.gitCommitDetails(workspace, hash).then((r) => {
      if (!live) return;
      if (r.success) setCommit(r.commit);
      else setError(r.error);
    });
    return () => { live = false; };
  }, [workspace, fileBus, hash]);

  const openFile = useCallback(async (f) => {
    vibrate();
    setFile(f); setDiff(null);
    const r = await fileBus.gitCommitFileDiff(workspace, hash, f.path, f.oldPath);
    setDiff(r.success ? r.diff : `# ${r.error}`);
  }, [workspace, fileBus, hash]);

  const header = (title, back) => (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border flex-shrink-0">
      <button onClick={() => { vibrate(); back(); }} className="p-1.5 bg-surface-2 hover:bg-surface-3 text-text rounded-brand" aria-label={t("common.back")}>
        <ChevronLeft size={18} />
      </button>
      <div className="flex-1 min-w-0 text-sm font-medium text-text truncate" title={title}>{title}</div>
      {!file && commit && (
        <button onClick={(e) => { vibrate(); onOpenMenu(commit.hash, e); }} className="p-1.5 bg-surface-2 hover:bg-surface-3 text-text rounded-brand" aria-label={t("git.graphActions")}>
          <MoreVertical size={18} />
        </button>
      )}
    </div>
  );

  if (file) {
    return (
      <div className="h-full flex flex-col min-h-0">
        {header(file.path, () => { setFile(null); setDiff(null); })}
        <div className="flex-1 overflow-auto p-3 modal-scrollable">
          {diff === null
            ? <div className="flex justify-center py-8 text-text-muted"><Loader2 size={18} className="animate-spin" /></div>
            : diff ? <DiffBody diff={diff} /> : <div className="text-center text-text-muted py-8">{t("git.noChanges")}</div>}
        </div>
      </div>
    );
  }

  if (!commit) {
    return (
      <div className="h-full flex flex-col min-h-0">
        {header(short(hash), onBack)}
        {error
          ? <div className="px-4 py-3 text-sm text-red-400">{error}</div>
          : <div className="flex justify-center py-8 text-text-muted"><Loader2 size={18} className="animate-spin" /></div>}
      </div>
    );
  }

  const [subject, ...bodyLines] = commit.body.split("\n");
  const body = bodyLines.join("\n").trim();
  const date = new Date(commit.authorTime).toLocaleString();

  return (
    <div className="h-full flex flex-col min-h-0">
      {header(subject, onBack)}
      <div className="flex-1 overflow-y-auto modal-scrollable">
        <div className="px-4 py-3 space-y-3 border-b border-border">
          <div className="text-text font-semibold break-words">{subject}</div>
          {body && <pre className="text-sm text-text-muted whitespace-pre-wrap break-words font-sans">{body}</pre>}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-text-muted">{t("git.commitHash")}</dt>
            <dd className="flex items-center gap-1.5 min-w-0">
              <code className="truncate text-text">{commit.hash}</code>
              <button onClick={() => { vibrate(); copy(commit.hash); }} className="p-1 text-text-muted hover:text-text flex-shrink-0" aria-label={t("git.copyHash")}><Copy size={13} /></button>
            </dd>
            {commit.parents.length > 0 && <>
              <dt className="text-text-muted">{t("git.parents")}</dt>
              <dd className="flex flex-wrap gap-1.5">
                {commit.parents.map((p) => (
                  <button key={p} onClick={() => { vibrate(); onSelectCommit(p); }} className="font-mono text-brand-500 hover:underline">{short(p)}</button>
                ))}
              </dd>
            </>}
            <dt className="text-text-muted">{t("git.author")}</dt>
            <dd className="text-text break-all">{commit.author} &lt;{commit.email}&gt;</dd>
            <dt className="text-text-muted">{t("git.commitDate")}</dt>
            <dd className="text-text">{date}</dd>
            {commit.committer !== commit.author && <>
              <dt className="text-text-muted">{t("git.committer")}</dt>
              <dd className="text-text break-all">{commit.committer}</dd>
            </>}
          </dl>
        </div>
        <div className="px-4 pt-3 pb-1 text-xs text-text-muted">{t("git.filesChanged", { count: commit.files.length })}</div>
        <div className="px-2 pb-4">
          {commit.files.map((f) => {
            const name = f.path.split("/").pop();
            const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
            return (
              <button key={`${f.oldPath || ""}:${f.path}`} onClick={() => openFile(f)} className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-surface-2 text-left">
                <span className="flex-shrink-0 flex items-center">{resolveFileIcon({ name, path: f.path, type: "file" }, 16)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-text truncate">{name}</span>
                  {(dir || f.oldPath) && <span className="block text-xs text-text-muted truncate">{f.oldPath ? `${f.oldPath} →` : dir}</span>}
                </span>
                {f.added !== null && f.added > 0 && <span className="text-xs text-[var(--success)]">+{f.added}</span>}
                {f.deleted !== null && f.deleted > 0 && <span className="text-xs text-[var(--danger)]">-{f.deleted}</span>}
                <span className={`font-mono font-bold w-5 h-5 flex items-center justify-center text-[11px] rounded bg-surface-2 flex-shrink-0 ${GIT_STATUS_COLORS[f.status] || "text-text-muted"}`}>{f.status}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
