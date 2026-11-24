"use client";

import { useSyncExternalStore } from "react";
import { APP_NAME, SHELL_APP_NAME } from "@/shared/constants/appName";
import { inNativeShell } from "@/shared/lib/nativeShell";

const noSubscribe = () => () => {};

// Which install is showing the page: the Android shell injects its bridge, everything else is the
// web build. The server render has no window, so it says web and the client corrects it.
export function useAppName() {
  return useSyncExternalStore(noSubscribe, () => (inNativeShell() ? SHELL_APP_NAME : APP_NAME), () => APP_NAME);
}
