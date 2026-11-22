// Bridge to the Android WebView shell (android-shell/): the shell injects SHELL_BRIDGE and
// routes the hardware Back key through SHELL_BACK_HOOK before acting on its own.
export const SHELL_BRIDGE = "NineRemoteShell";
export const SHELL_BACK_HOOK = "__nineRemoteShellBack";

// Answers SHELL_BACK_HOOK returns to the shell.
export const SHELL_BACK = { HANDLED: "handled", EXIT: "exit", BACK: "back" };

export function inNativeShell() {
  return typeof window !== "undefined" && !!window[SHELL_BRIDGE];
}
