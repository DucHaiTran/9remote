"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/shared/i18n";
import { ArrowUp, Globe, Loader2, X } from "@/shared/components/ui/Icon";
import { useBackClose } from "@/shared/hooks/useBackClose";
import { vibrate } from "@/shared/utils/vibration";
import { pushSummary } from "../lib/gitOutput.js";
import { GIT_DEFAULT_REMOTE } from "../constants/fileExplorer.js";
import GitRemotesDialog from "./GitRemotesDialog";

const INPUT_CLS = "w-full min-w-0 px-2.5 py-1.5 bg-surface-2 rounded-brand text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-brand-500";

// Push `source` (a branch name, or a commit hash) to a branch on a chosen remote. `label`
// names what is pushed in the title; `branch` pre-fills the target. Remotes can be managed
// from here, so a repo with none is one tap from its first push.
export default function GitPushDialog({ workspace, fileBus, source, label, branch = "", upstreamDefault = false, onClose, onPushed = null }) {
  useBackClose(onClose);
  const { t } = useI18n();
  const [remotes, setRemotes] = useState(null);
  const [remote, setRemote] = useState("");
  const [target, setTarget] = useState(branch);
  const [setUpstream, setSetUpstream] = useState(upstreamDefault);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  const [managing, setManaging] = useState(false);

  const loadRemotes = async () => {
    const res = await fileBus.gitRemoteList(workspace);
    const list = res?.success ? res.remotes : [];
    setRemotes(list);
    setRemote((cur) => (list.some((r) => r.name === cur) ? cur
      : (list.find((r) => r.name === GIT_DEFAULT_REMOTE) || list[0])?.name || ""));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- one host read per open; managing reloads it
  useEffect(() => { loadRemotes(); }, []);

  const push = async () => {
    vibrate();
    setBusy(true);
    setResult(null);
    const res = await fileBus.gitPush(workspace, { remote, ref: source, branch: target.trim(), setUpstream, forceWithLease: force });
    setBusy(false);
    if (!res?.success) { setResult({ ok: false, text: res?.output || res?.error || t("git.pushFailed") }); return; }
    onPushed?.(pushSummary(t, res.output));
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-overlay z-[100]">
      <div className="absolute inset-0 scrim fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative card-elev w-full max-w-sm p-5 my-auto overflow-y-auto pop-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-[14px] font-semibold text-text flex items-center gap-2 min-w-0">
            <ArrowUp size={14} className="shrink-0" /><span className="truncate">{t("git.pushWhat", { name: label })}</span>
          </h3>
          <button onClick={onClose} aria-label={t("common.close")} className="p-1 -mr-1 -mt-1 text-text-muted hover:text-text hover:bg-surface-2 rounded-[3px] transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>

        {remotes === null ? (
          <div className="flex justify-center py-6 text-text-muted"><Loader2 size={18} className="animate-spin" /></div>
        ) : remotes.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-text-muted">{t("git.noRemotesPush")}</p>
            <button type="button" onClick={() => setManaging(true)} className="w-full py-2 rounded-brand bg-surface-2 hover:bg-surface-3 text-sm text-text flex items-center justify-center gap-2">
              <Globe size={14} />{t("git.manageRemotes")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="flex items-center justify-between text-[11px] font-medium text-text-muted">
                {t("git.remoteLabel")}
                <button type="button" onClick={() => setManaging(true)} className="text-brand-500 hover:underline font-normal">{t("git.manageRemotes")}</button>
              </span>
              <select value={remote} onChange={(e) => setRemote(e.target.value)} className={INPUT_CLS}>
                {remotes.map((r) => <option key={r.name} value={r.name}>{r.name} — {r.pushUrl || r.fetchUrl}</option>)}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] font-medium text-text-muted">{t("git.targetBranch")}</span>
              <input className={INPUT_CLS} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="main" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
              <input type="checkbox" checked={setUpstream} onChange={(e) => setSetUpstream(e.target.checked)} className="w-4 h-4 accent-brand-500" />
              {t("git.setUpstream")}
            </label>
            <label className="flex items-center gap-2 text-xs text-text-muted cursor-pointer select-none">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="w-4 h-4 accent-brand-500" />
              {t("git.forceWithLease")}
            </label>
            {result && !result.ok && (
              <div className="px-3 py-2 rounded-brand text-xs text-red-400 bg-red-500/15 whitespace-pre-wrap break-words max-h-40 overflow-y-auto">{result.text}</div>
            )}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={onClose} className="flex-1 py-2 rounded-brand bg-surface-2 hover:bg-surface-3 text-sm text-text-muted">{t("common.cancel")}</button>
              <button type="button" disabled={busy || !remote || !target.trim()} onClick={push} className="flex-1 py-2 rounded-brand bg-brand-500 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}{t("git.push")}
              </button>
            </div>
          </div>
        )}
      </div>
      {managing && <GitRemotesDialog workspace={workspace} fileBus={fileBus} onClose={() => { setManaging(false); loadRemotes(); }} />}
    </div>,
    document.body
  );
}
