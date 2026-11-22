import { useTerminalStore } from "@/shared/stores/terminalStore";
import { DESKTOP_BREAKPOINT } from "@/features/terminal/constants/terminalConfig";

// Shows a workspace's git graph: desktop raises the right panel's Graph tab, mobile pushes
// the git screen on it. Both read the main host's bus, so callers offer it for main-host
// workspaces only. `repoPath` (a picked worktree) wins over the workspace root on mobile.
export function openGitGraph({ workspaceId, workspacePath, repoPath = null }) {
  const term = useTerminalStore.getState();
  if ((term.activeWorkspaceId ?? null) !== workspaceId) term.setActiveWorkspaceId(workspaceId);
  if (window.innerWidth >= DESKTOP_BREAKPOINT) term.setRightPanelTab("graph", workspacePath);
  else term.pushView({ type: "git", workspace: repoPath || workspacePath, tab: "graph" });
}
