"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { isImageFile } from "../constants/fileExplorer.js";
import ConfirmDialog from "@/shared/components/ui/ConfirmDialog";
import GitActionsModal from "./GitActionsModal.js";
import GitGraphView from "./GitGraphView.js";
import ScmPanel from "./ScmPanel.js";
import { ChevronLeft, Eye, Trash2, RefreshCw, GitBranch } from "@/shared/components/ui/Icon";
import { vibrate } from "@/shared/utils/vibration";
import { useI18n } from "@/shared/i18n";
import DiffBody from "./DiffBody.js";
import ImageDiffView from "./ImageDiffView.js";

export default function GitPanel({ workspace, fileBus, onBack, onOpenFile, initialTab = "status" }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState(initialTab);
  const [diffLoading, setDiffLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFiles, setStatusFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFileStatus, setSelectedFileStatus] = useState(null);
  const [diff, setDiff] = useState("");
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({ isOpen: false });
  const [branch, setBranch] = useState("");
  const [ahead, setAhead] = useState(null);
  const [behind, setBehind] = useState(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  // Bumped by the header refresh so the graph reloads without lifting its state up here.
  const [graphKey, setGraphKey] = useState(0);

  // Load git status
  const loadStatus = useCallback(async () => {
    setError("");

    const result = await fileBus.gitStatus(workspace);

    if (result.success) {
      setStatusFiles(result.files);
    } else {
      setError(result.error);
    }

    fileBus.gitBranch(workspace).then((r) => {
      if (!r?.success) return;
      setBranch(r.branch);
      setAhead(r.ahead ?? null);
      setBehind(r.behind ?? null);
    });

  }, [workspace, fileBus]);

  // Load diff
  const loadDiff = useCallback(async (file = null, status = null) => {
    setSelectedFile(file);
    setSelectedFileStatus(status);
    if (file && isImageFile(file)) {
      setDiff("image");
      setDiffLoaded(true);
      setDiffLoading(false);
      return;
    }
    setDiffLoading(true);
    setError("");

    const result = await fileBus.gitDiff(workspace, file, status);

    if (result.success) {
      setDiff(result.diff);
      setDiffLoaded(true);
    } else {
      setError(result.error);
    }

    setDiffLoading(false);
  }, [workspace, fileBus]);

  // Load status on mount
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const openScmDiff = useCallback((file) => {
    loadDiff(file.path, file.status);
    setActiveTab("diff");
  }, [loadDiff]);

  // Handle tab switch to diff - load first file if not loaded yet
  const handleSwitchToDiff = useCallback(() => {
    setActiveTab("diff");
    if (!diffLoaded && statusFiles.length > 0) {
      const firstFile = statusFiles[0];
      loadDiff(firstFile.path, firstFile.status);
    }
  }, [diffLoaded, loadDiff, statusFiles]);

  // Handle discard changes (for diff tab)
  const handleDiscard = useCallback(() => {
    if (!selectedFile || !selectedFileStatus) return;
    handleDiscardFile(selectedFile, selectedFileStatus);
  }, [selectedFile, selectedFileStatus]);

  // Handle discard for specific file
  const handleDiscardFile = useCallback((filePath, status) => {
    const fileName = filePath.split("/").pop();
    const isUntracked = status === "?";

    setConfirmDialog({
      isOpen: true,
      title: t("git.discardConfirmTitle"),
      message: isUntracked ? t("git.discardConfirmDelete", { name: fileName }) : t("git.discardConfirmDiscard", { name: fileName }),
      onConfirm: async () => {
        const result = await fileBus.gitDiscard(workspace, filePath, status);
        if (result.success) {
          await loadStatus();
          // If in diff tab, update selection
          if (activeTab === "diff") {
            const remaining = statusFiles.filter(f => f.path !== filePath);
            if (remaining.length > 0) {
              loadDiff(remaining[0].path, remaining[0].status);
            } else {
              setActiveTab("status");
              setSelectedFile(null);
              setDiff("");
              setDiffLoaded(false);
            }
          }
        } else {
          setError(result.error);
        }
      }
    });
  }, [fileBus, workspace, loadStatus, loadDiff, statusFiles, activeTab, t]);

  // Open file in editor
  const handleOpenFile = useCallback((filePath) => {
    // git returns relative paths; join against absolute workspace root
    const fullPath = workspace.endsWith("/")
      ? `${workspace}${filePath}`
      : `${workspace}/${filePath}`;
    onOpenFile?.(fullPath);
  }, [workspace, onOpenFile]);

  return (
    <div className="h-full bg-bg flex flex-col">
      {/* Header */}
      <div className="bg-surface border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => { vibrate(); onBack(); }}
          className="p-2 bg-surface-2 hover:bg-surface-2 text-text rounded-brand transition-all duration-200"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-text text-lg font-semibold truncate flex items-center gap-2">
          {t("git.title")}{branch ? <span className="text-text-muted font-normal"> · {branch}</span> : null}
          {ahead > 0 && <span className="text-xs font-medium px-1.5 py-0.5 rounded-brand bg-brand-500/15 text-brand-500">↑{ahead}</span>}
          {behind > 0 && <span className="text-xs font-medium px-1.5 py-0.5 rounded-brand bg-surface-3 text-text-muted">↓{behind}</span>}
        </h1>
        <button
          onClick={() => { vibrate(); setActionsOpen(true); }}
          className="ml-auto p-2 bg-surface-2 hover:bg-surface-3 text-text rounded-brand transition-all duration-200"
          title={t("git.gitActions")}
        >
          <GitBranch className="w-5 h-5" />
        </button>
        <button
          onClick={() => {
            vibrate();
            if (activeTab === "status") {
              loadStatus();
            } else if (activeTab === "graph") {
              setGraphKey((k) => k + 1);
              loadStatus();
            } else {
              loadDiff(selectedFile, selectedFileStatus);
            }
          }}
          className="p-2 bg-surface-2 hover:bg-surface-2 text-text rounded-brand transition-all duration-200"
          title={t("common.refresh")}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border flex-shrink-0">
        <button
          onClick={() => { vibrate(); setActiveTab("status"); }}
          className={`flex-1 py-3 text-center font-medium transition ${
            activeTab === "status"
              ? "text-text border-b-2 border-brand-500"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t("git.status")}
        </button>
        <button
          onClick={() => { vibrate(); handleSwitchToDiff(); }}
          className={`flex-1 py-3 text-center font-medium transition ${
            activeTab === "diff"
              ? "text-text border-b-2 border-brand-500"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t("git.diffTab")}
        </button>
        <button
          onClick={() => { vibrate(); setActiveTab("graph"); }}
          className={`flex-1 py-3 text-center font-medium transition ${
            activeTab === "graph"
              ? "text-text border-b-2 border-brand-500"
              : "text-text-muted hover:text-text"
          }`}
        >
          {t("git.graphTab")}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-500/20 border-b border-red-500/50 px-4 py-2 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Graph owns its scroll so the details view and the list keep separate positions. */}
      {activeTab === "graph" && (
        <div className="flex-1 min-h-0">
          <GitGraphView
            key={graphKey}
            workspace={workspace}
            fileBus={fileBus}
            onShowChanges={() => setActiveTab("status")}
            onChanged={loadStatus}
          />
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden modal-scrollable ${activeTab === "graph" ? "hidden" : ""}`}>
        {activeTab === "status" ? (
          // Same Source Control panel as desktop: Staged / Changes / Untracked, stage, unstage, tree.
          <ScmPanel
            workspace={workspace}
            fileBus={fileBus}
            onOpenFile={onOpenFile}
            onOpenDiff={openScmDiff}
            onChanged={loadStatus}
          />
        ) : (
          <div className="p-4 min-w-0">
            {/* File selector and discard button */}
            {statusFiles.length > 0 && (
              <div className="flex gap-2 mb-4">
                <select
                  value={selectedFile || ""}
                  onChange={(e) => {
                    vibrate();
                    const file = statusFiles.find(f => f.path === e.target.value);
                    if (file) {
                      loadDiff(file.path, file.status);
                    }
                  }}
                  className="flex-1 min-w-0 px-3 py-2 bg-surface-2 rounded-brand text-text focus:outline-none transition-all duration-150 ease-out"
                >
                  {statusFiles.map(file => (
                    <option key={file.path} value={file.path}>
                      [{file.status}] {file.path}
                    </option>
                  ))}
                </select>
                {selectedFile && selectedFileStatus !== "D" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); vibrate(); handleOpenFile(selectedFile); }}
                    disabled={diffLoading}
                    className="h-9 w-9 flex-shrink-0 bg-surface-2 hover:bg-surface-3 disabled:cursor-not-allowed text-text rounded-brand transition-all duration-200 flex items-center justify-center"
                    title={t("git.openFile")}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => { vibrate(); handleDiscard(); }}
                  disabled={!selectedFile || diffLoading}
                  className="h-9 w-9 flex-shrink-0 bg-red-500/10 hover:bg-red-500/20 disabled:bg-surface-2 disabled:cursor-not-allowed text-red-400 rounded-brand transition-all duration-200 flex items-center justify-center"
                  title={t("git.discardChangesTitle")}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                </button>
              </div>
            )}
            
            {diffLoading ? (
              <div className="flex items-center justify-center h-32 text-text-muted">
                {t("common.loading")}
              </div>
            ) : selectedFile && isImageFile(selectedFile) ? (
              <ImageDiffView
                filePath={selectedFile}
                status={selectedFileStatus}
                workspace={workspace}
                fileBus={fileBus}
              />
            ) : diff ? (
              <DiffBody diff={diff} />
            ) : (
              <div className="flex items-center justify-center h-32 text-text-muted">
                {t("git.noChanges")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        isOpen={confirmDialog.isOpen}
        onClose={() => setConfirmDialog({ isOpen: false })}
        onConfirm={confirmDialog.onConfirm}
        title={confirmDialog.title}
        message={confirmDialog.message}
      />
      {actionsOpen && (
        <GitActionsModal
          workspace={workspace}
          fileBus={fileBus}
          branch={branch}
          changedCount={statusFiles.length}
          onDone={loadStatus}
          onClose={() => setActionsOpen(false)}
        />
      )}
    </div>
  );
}
