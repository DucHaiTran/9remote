"use client";

import { ChevronRight, Folder, GitFork, History, Pencil, Plus, Trash2 } from "@/shared/components/ui/Icon";
import { vibrate } from "@/shared/utils/vibration";
import { useI18n } from "@/shared/i18n";
import IconMenu from "@/shared/components/ui/IconMenu";
import { useWorkspaceGit } from "../hooks/useWorkspaceGit";
import { useWorkspaceChangedCount } from "../hooks/useWorkspaceChangedCount";
import { workspaceGitPath, workspaceFolderName } from "../lib/workspaceGrouping";
import { isDefaultBranch } from "../constants/terminalConfig";
import { statusCounts, statusVisual } from "@/shared/utils/statusVisual";
import BranchBadge from "./BranchBadge";

// Hidden until the row is hovered on pointer devices; dimmed but visible on touch.
// The row must carry the plain `group` class for this to fire. Shared by the
// sidebar's trees — the main host's and every other host's.
export const REVEAL_CLS = "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60 transition-opacity";

// One workspace folder row: chevron + folder + name (+ off-default branch badge)
// and the new-terminal / rename / delete actions a caller wires. Null callbacks
// hide their action, so a read-only tree (another host's) renders the same shape.
export default function WorkspaceHeader({
  workspace, isActive, connected, collapsed, fileBus,
  onToggleCollapse, onSelect, onNewTerminal, onDelete, onRename,
  onAddWorkspace = null,
  onOpenGraph = null,
  onOpenHistory = null,
  dragHandlers = null,
  statusMap = null,
  mobile = false
}) {
  const { t } = useI18n();
  const gitPath = workspaceGitPath(workspace);
  // No fileBus (another host's tree) must NOT fall back to the main host's bus —
  // that would scan this workspace's path on the wrong machine.
  const { branch } = useWorkspaceGit(gitPath, fileBus, { enabled: !!fileBus });
  // Dirty dot is derived from the same count snapshot as the pane and git panel badges.
  const { count } = useWorkspaceChangedCount(gitPath, fileBus, { enabled: !!fileBus });
  const dirty = count > 0;
  // A renamed workspace is an alias: its folder still shows beside it.
  const folder = workspaceFolderName(workspace);
  const aliasOf = folder && folder.toLowerCase() !== (workspace.name || "").toLowerCase() ? folder : null;
  const showBranch = !!branch && !isDefaultBranch(branch) && branch !== workspace.name;
  // A closed workspace still has to answer "what's running in here?" — one dot per
  // present state, in the same language as a session row's dot.
  const rolled = !collapsed
    ? []
    : statusCounts((workspace.items || []).map((s) => statusMap?.[s.id]?.state));

  // The row itself toggles expand/collapse, matching the chevron behavior.
  const rowClick = onToggleCollapse ? () => { vibrate(); onToggleCollapse(); } : onSelect;

  return (
    <div
      onClick={rowClick}
      {...(dragHandlers || {})}
      className={`relative pr-2 flex items-center gap-1.5 group group/grp transition-colors select-none ${dragHandlers ? "touch-pan-y" : ""} ${
        mobile ? "py-1 mt-1" : "py-1.5"
      } ${rowClick ? "cursor-pointer hover:bg-text/[0.06]" : ""}`}
    >
      <button
        onClick={(e) => { e.stopPropagation(); vibrate(); onToggleCollapse?.(); }}
        className="text-text-subtle hover:text-text flex-shrink-0"
        tabIndex={-1}
      >
        <ChevronRight size={mobile ? 18 : 12} className={`transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`} />
      </button>
      <Folder size={mobile ? 14 : 13.5} className="text-text-muted flex-shrink-0" />
      <span className="flex-1 min-w-0 flex flex-col">
        <span className={`flex items-center gap-1.5 min-w-0 ${isActive ? "text-text" : "text-text-muted"}`}>
          <span
            className={`font-medium uppercase truncate ${
              mobile
                ? `text-[13px] tracking-wide ${isActive ? "text-text" : "text-text/90"}`
                : `text-[12px] ${isActive ? "text-text" : "text-text-muted"}`
            }`}
            data-tip={workspace.name}
          >
            {workspace.name}
          </span>
          {rolled.map(({ state, count }) => {
            const v = statusVisual(state);
            return (
              <span
                key={state}
                className="flex items-center gap-0.5 flex-shrink-0"
                title={`${t(v.label)}${count > 1 ? ` ×${count}` : ""}`}
              >
                <span className={`w-2 h-2 rounded-full term-dot ${v.cls}${v.pulse ? ` pulse-${v.pulse}` : ""}`} style={{ background: v.dot }} />
                {count > 1 && <span className="text-[10px] text-text-subtle leading-none">{count}</span>}
              </span>
            );
          })}
        </span>
        {/* Second line: the folder behind an alias, then an off-default branch. The path
            itself is dropped and a default branch stays hidden; neither repeats the name. */}
        {(aliasOf || showBranch) && (
          <span className={`${mobile ? "text-[11px]" : "text-[10px]"} text-text-subtle leading-tight flex items-center gap-1.5 min-w-0`}>
            {aliasOf && (
              <span className="flex items-center gap-1 min-w-0 truncate" data-tip={workspace.path || aliasOf}>
                <Folder size={mobile ? 11 : 10} className="flex-shrink-0" />
                <span className="truncate">{aliasOf}</span>
              </span>
            )}
            {showBranch && <BranchBadge branch={branch} dirty={dirty} className="truncate flex-shrink-0 max-w-[7rem]" />}
          </span>
        )}
      </span>
      {/* New terminal (+) and "..." — the ExplorerRow door: name runs full width,
          hover floats the cluster over its end with a surface backdrop. */}
      {/* Phone: the buttons are always shown, so they take their own room instead of
          floating over the name (which hid a long alias). */}
      <div className={`flex items-center ${mobile ? "flex-shrink-0 gap-0.5" : "gap-1.5 absolute right-1 top-1/2 -translate-y-1/2 px-1 rounded-[3px] bg-surface-2 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100"} transition-opacity`}>
        {onOpenGraph && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); vibrate(); onOpenGraph(); }}
            disabled={!connected}
            className={`${mobile ? "p-1.5" : "p-0.5"} text-text-subtle hover:text-text rounded-[2px] transition-colors disabled:opacity-40`}
            title={t("git.openGitGraph")}
            aria-label={t("git.openGitGraph")}
          >
            <GitFork size={mobile ? 18 : 13.5} />
          </button>
        )}
        {onOpenHistory && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); vibrate(); onOpenHistory(); }}
            disabled={!connected}
            className={`${mobile ? "p-1.5" : "p-0.5"} text-text-subtle hover:text-text rounded-[2px] transition-colors disabled:opacity-40`}
            title={t("agentHistory.title")}
            aria-label={t("agentHistory.title")}
          >
            <History size={mobile ? 18 : 13.5} />
          </button>
        )}
        {onNewTerminal && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); vibrate(); onNewTerminal(); }}
            disabled={!connected}
            className={`${mobile ? "p-1.5" : "p-0.5"} text-text-subtle hover:text-text rounded-[2px] transition-colors disabled:opacity-40`}
            title={t("terminal.newTerminal")}
          >
            <Plus size={mobile ? 18 : 13.5} />
          </button>
        )}
        <IconMenu
          size={mobile ? 18 : 13.5}
          label={t("sessions.sessionActions")}
          revealCls=""
          items={[
            onNewTerminal && connected && {
              icon: Plus, label: t("terminal.newTerminal"),
              onClick: () => onNewTerminal()
            },
            onAddWorkspace && connected && {
              icon: Folder, label: t("workspaces.newWorkspace"),
              onClick: () => onAddWorkspace()
            },
            onRename && {
              icon: Pencil, label: t("workspaces.rename"),
              onClick: () => onRename()
            },
            onDelete && connected && {
              icon: Trash2, label: t("workspaces.delete"), danger: true,
              onClick: () => onDelete()
            }
          ]}
        />
      </div>
    </div>
  );
}
