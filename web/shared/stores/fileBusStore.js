"use client";

import { create } from "zustand";
import { useConnectionStore } from "@/shared/stores/connectionStore";
import { normalizePathsResponse } from "@/features/fileExplorer/constants/fileExplorer.js";
import { uploadFiles as transferUpload, downloadFile as transferDownload, streamMedia as transferStream } from "@/features/fileExplorer/lib/fileTransfer.js";

const normResolve = (resolve) => (res) => {
  resolve(normalizePathsResponse(res));
};

// One file API, any bus: the main singleton and every fleet host's facade are the
// same object built over a different bus getter — the only per-host difference.
// `getLiveBus` is the subscription door: unlike one-shot requests it must attach
// the moment the bus object exists (socket.io allows `on` before connect), so a
// watcher registering pre-connect never misses the first events.
export function makeFileBus(getBus, getProtocol = () => null, getLiveBus = getBus) {
  return {
  getSystemInfo: () => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("getSystemInfo", resolve);
  }),

  getFiles: (dirPath, showHidden = false) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("getFiles", { dirPath, showHidden }, normResolve(resolve));
  }),

  readFile: (filePath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("readFile", { filePath }, resolve);
  }),

  readImage: (filePath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("readImage", { filePath }, resolve);
  }),

  readMedia: (filePath, opts = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("readMedia", { filePath, maxDim: opts.maxDim }, resolve);
  }),

  writeFile: (filePath, content) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("writeFile", { filePath, content }, resolve);
  }),

  createItem: (itemPath, type) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("createItem", { itemPath, type }, resolve);
  }),

  deleteItem: (itemPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("deleteItem", { itemPath }, resolve);
  }),

  renameItem: (oldPath, newPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("renameItem", { oldPath, newPath }, resolve);
  }),

  copyItem: (srcPath, destPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("copyItem", { srcPath, destPath }, resolve);
  }),

  gitStatus: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitStatus", { repoPath }, normResolve(resolve));
  }),

  gitChangedCount: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitChangedCount", { repoPath }, resolve);
  }),

  gitFileStatus: (repoPath, filePath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitFileStatus", { repoPath, filePath }, normResolve(resolve));
  }),

  gitDiff: (repoPath, file, status) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitDiff", { repoPath, file, status }, resolve);
  }),

  gitShowMedia: (repoPath, file, ref = "HEAD") => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitShowMedia", { repoPath, file, ref }, resolve);
  }),

  searchFiles: (workspace, query) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("searchFiles", { workspace, query }, normResolve(resolve));
  }),

  gitDiscard: (repoPath, file, status, { keepStaged = false } = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitDiscard", { repoPath, file, status, keepStaged }, resolve);
  }),

  searchInFiles: (workspace, query, options = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    const { caseSensitive = false, wholeWord = false, regex = false, includeGlob = "", excludeGlob = "" } = options;
    bus.emit("searchInFiles", { workspace, query, caseSensitive, wholeWord, regex, includeGlob, excludeGlob }, normResolve(resolve));
  }),

  replaceInFiles: (workspace, query, replacement, options = {}, files = []) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    const { caseSensitive = false, regex = false, includeGlob = "", excludeGlob = "" } = options;
    bus.emit("replaceInFiles", { workspace, query, replacement, caseSensitive, regex, includeGlob, excludeGlob, files }, resolve);
  }),

  watchDir: (dirPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("watchDir", { dirPath }, resolve);
  }),

  unwatchDir: (dirPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("unwatchDir", { dirPath }, resolve);
  }),

  onFileChange: (handler) => {
    const bus = getLiveBus();
    if (!bus) return () => {};
    bus.on("fileChange", handler);
    return () => bus.off("fileChange", handler);
  },

  revealInOS: (filePath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("revealInOS", { filePath }, resolve);
  }),

  openInTerminal: (dirPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("openInTerminal", { dirPath }, resolve);
  }),

  getFileTree: (dirPath, depth = 1, showHidden = false) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("getFileTree", { dirPath, depth, showHidden }, normResolve(resolve));
  }),

  gitBranch: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitBranch", { repoPath }, resolve);
  }),

  gitScanRepos: (rootPath, maxDepth, force) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitScanRepos", { rootPath, maxDepth, force }, resolve);
  }),

  gitWorkspaceChangedCount: (rootPath, maxDepth, force) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitWorkspaceChangedCount", { rootPath, maxDepth, force }, resolve);
  }),

  gitRefreshRepos: (rootPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitRefreshRepos", { rootPath }, resolve);
  }),

  gitWorktreeList: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitWorktreeList", { repoPath }, resolve);
  }),

  gitWorktreeAdd: (repoPath, worktreePath, branch, newBranch) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitWorktreeAdd", { repoPath, worktreePath, branch, newBranch }, resolve);
  }),

  gitWorktreeRemove: (repoPath, worktreePath, opts = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitWorktreeRemove", { repoPath, worktreePath, ...opts }, resolve);
  }),

  gitBranchList: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitBranchList", { repoPath }, resolve);
  }),

  gitGraph: (repoPath, opts = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitGraph", { repoPath, skip: opts.skip, limit: opts.limit, branch: opts.branch }, resolve);
  }),

  gitCommitDetails: (repoPath, hash) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitCommitDetails", { repoPath, hash }, resolve);
  }),

  gitCommitFileDiff: (repoPath, hash, file, oldPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitCommitFileDiff", { repoPath, hash, file, oldPath }, resolve);
  }),

  gitGraphAction: (repoPath, action, params = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitGraphAction", { repoPath, action, ...params }, resolve);
  }),

  gitBranchCheckout: (repoPath, branch, create) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitBranchCheckout", { repoPath, branch, create }, resolve);
  }),

  gitAdd: (repoPath, files) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitAdd", { repoPath, files }, resolve);
  }),

  gitReset: (repoPath, files) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitReset", { repoPath, files }, resolve);
  }),

  gitCommit: (repoPath, message) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitCommit", { repoPath, message }, resolve);
  }),

  // opts: { remote, ref, branch, setUpstream, forceWithLease } — none = plain `git push`.
  gitPush: (repoPath, opts = {}) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitPush", { repoPath, ...opts }, resolve);
  }),

  gitRemoteList: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitRemoteList", { repoPath }, resolve);
  }),

  // action: add | setUrl | rename | remove; payload: { name, url, newName }
  gitRemoteEdit: (repoPath, action, payload) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitRemoteEdit", { repoPath, action, ...payload }, resolve);
  }),

  gitPull: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitPull", { repoPath }, resolve);
  }),

  gitFetch: (repoPath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitFetch", { repoPath }, resolve);
  }),

  gitLog: (repoPath, limit = 50) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("gitLog", { repoPath, limit }, normResolve(resolve));
  }),

  uploadFiles: (targetDir, items, callbacks) => {
    const bus = getBus();
    if (!bus) {
      callbacks?.onError?.(null, new Error("Not connected"));
      return Promise.resolve();
    }
    return transferUpload({
      bus,
      protocolRef: getProtocol(),
      targetDir,
      items,
      callbacks
    });
  },

  downloadFile: (filePath, callbacks) => {
    const bus = getBus();
    if (!bus) {
      callbacks?.onError?.(new Error("Not connected"));
      return Promise.resolve();
    }
    return transferDownload({
      bus,
      protocolRef: getProtocol(),
      filePath,
      ...callbacks
    });
  },

  streamMedia: (filePath, callbacks) => {
    const bus = getBus();
    if (!bus) {
      callbacks?.onError?.(new Error("Not connected"));
      return { cancel: () => {} };
    }
    return transferStream({
      bus,
      filePath,
      ...callbacks
    });
  },

  previewStart: (filePath) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false, error: "Not connected" });
    bus.emit("preview:start", { filePath }, resolve);
  }),

  previewEnd: (sessionId) => new Promise((resolve) => {
    const bus = getBus();
    if (!bus) return resolve({ success: false });
    bus.emit("preview:end", { sessionId }, resolve);
  })
  };
}

const getMainBus = () => {
  const state = useConnectionStore.getState();
  if (!state.connected) return null;
  return state.busRef?.current || state.bus;
};
const getMainProtocol = () => useConnectionStore.getState().protocolRef;
// Ungated: the bus object existing is enough to subscribe.
const getMainLiveBus = () => {
  const state = useConnectionStore.getState();
  return state.busRef?.current || state.bus;
};

export const useFileBusStore = create(() => makeFileBus(getMainBus, getMainProtocol, getMainLiveBus));
