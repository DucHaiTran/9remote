"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/shared/i18n";
import { Check, Globe, Loader2, Pencil, Plus, Trash2, X } from "@/shared/components/ui/Icon";
import ConfirmDialog from "@/shared/components/ui/ConfirmDialog";
import { useBackClose } from "@/shared/hooks/useBackClose";
import { vibrate } from "@/shared/utils/vibration";

const INPUT_CLS = "w-full min-w-0 px-2.5 py-1.5 bg-surface-2 rounded-brand text-[13px] text-text placeholder:text-text-subtle focus:outline-none focus:ring-1 focus:ring-brand-500";

// The repo's remotes: list, add, change a URL or name, remove. Shared by the desktop Source
// Control panel and the phone's git screen.
export default function GitRemotesDialog({ workspace, fileBus, onClose, onChanged = null }) {
  useBackClose(onClose);
  const { t } = useI18n();
  const [remotes, setRemotes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(null); // { name, newName, url }
  const [adding, setAdding] = useState({ name: "", url: "" });
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    const res = await fileBus.gitRemoteList(workspace);
    if (res?.success) setRemotes(res.remotes);
    else setError(res?.error || t("git.remotesLoadFailed"));
  }, [fileBus, workspace, t]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- the list arrives from the host after this runs
  useEffect(() => { load(); }, [load]);

  // One remote call at a time; a failure keeps the form open with git's own message.
  const edit = async (action, payload) => {
    setBusy(true);
    setError(null);
    const res = await fileBus.gitRemoteEdit(workspace, action, payload);
    setBusy(false);
    if (!res?.success) { setError(res?.error || t("git.remoteEditFailed")); return false; }
    await load();
    onChanged?.();
    return true;
  };

  const saveEdit = async () => {
    const { name, newName, url } = editing;
    const current = remotes.find((r) => r.name === name);
    if (url.trim() && url.trim() !== current?.fetchUrl && !(await edit("setUrl", { name, url: url.trim() }))) return;
    if (newName.trim() && newName.trim() !== name && !(await edit("rename", { name, newName: newName.trim() }))) return;
    setEditing(null);
  };

  const add = async () => {
    const name = adding.name.trim();
    const url = adding.url.trim();
    if (!name || !url) return;
    if (await edit("add", { name, url })) setAdding({ name: "", url: "" });
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="modal-overlay z-[100]">
      <div className="absolute inset-0 scrim fade-in" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative card-elev w-full max-w-md p-5 my-auto overflow-y-auto pop-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-[14px] font-semibold text-text flex items-center gap-2"><Globe size={14} />{t("git.remotes")}</h3>
          <button onClick={onClose} aria-label={t("common.close")} className="p-1 -mr-1 -mt-1 text-text-muted hover:text-text hover:bg-surface-2 rounded-[3px] transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>

        {error && <div className="mb-3 px-3 py-2 rounded-brand text-xs text-red-400 bg-red-500/15 whitespace-pre-wrap break-words">{error}</div>}

        {remotes === null ? (
          <div className="flex justify-center py-6 text-text-muted"><Loader2 size={18} className="animate-spin" /></div>
        ) : (
          <div className="space-y-2">
            {remotes.length === 0 && <p className="text-xs text-text-muted py-2">{t("git.noRemotes")}</p>}
            {remotes.map((r) => editing?.name === r.name ? (
              <div key={r.name} className="space-y-1.5 p-2 rounded-brand bg-surface-2/60">
                <input className={INPUT_CLS} value={editing.newName} onChange={(e) => setEditing({ ...editing, newName: e.target.value })} placeholder={t("git.remoteName")} />
                <input className={INPUT_CLS} value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} placeholder={t("git.remoteUrl")} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                <div className="flex justify-end gap-1.5">
                  <button type="button" onClick={() => setEditing(null)} className="px-3 py-1 rounded-brand text-xs text-text-muted hover:bg-surface-3">{t("common.cancel")}</button>
                  <button type="button" disabled={busy} onClick={saveEdit} className="px-3 py-1 rounded-brand text-xs bg-brand-500 text-white disabled:opacity-50 flex items-center gap-1">
                    <Check size={12} />{t("common.save")}
                  </button>
                </div>
              </div>
            ) : (
              <div key={r.name} className="flex items-center gap-2 p-2 rounded-brand bg-surface-2/40">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-text truncate">{r.name}</div>
                  <div className="text-[11px] text-text-muted truncate" title={r.fetchUrl}>{r.fetchUrl}</div>
                  {r.pushUrl && r.pushUrl !== r.fetchUrl && (
                    <div className="text-[11px] text-text-subtle truncate" title={r.pushUrl}>{t("git.pushUrl")}: {r.pushUrl}</div>
                  )}
                </div>
                <button type="button" title={t("common.edit")} onClick={() => { vibrate(); setEditing({ name: r.name, newName: r.name, url: r.fetchUrl }); }} className="p-1.5 text-text-muted hover:text-text rounded-[3px]">
                  <Pencil size={14} />
                </button>
                <button type="button" title={t("git.removeRemoteTitle")} onClick={() => { vibrate(); setRemoving(r.name); }} className="p-1.5 text-text-muted hover:text-red-400 rounded-[3px]">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <div className="pt-2 mt-1 border-t border-border space-y-1.5">
              <div className="text-[11px] font-medium text-text-muted">{t("git.addRemote")}</div>
              <input className={INPUT_CLS} value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} placeholder={remotes.length ? t("git.remoteName") : "origin"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <input className={INPUT_CLS} value={adding.url} onChange={(e) => setAdding({ ...adding, url: e.target.value })} placeholder="https://github.com/user/repo.git" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <div className="flex justify-end">
                <button type="button" disabled={busy || !adding.name.trim() || !adding.url.trim()} onClick={add} className="px-3 py-1.5 rounded-brand text-xs bg-brand-500 text-white disabled:opacity-50 flex items-center gap-1">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}{t("git.addRemote")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <ConfirmDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={async () => { const name = removing; setRemoving(null); await edit("remove", { name }); }}
        title={t("git.removeRemoteTitle")}
        message={t("git.removeRemoteConfirm", { name: removing || "" })}
      />
    </div>,
    document.body
  );
}
