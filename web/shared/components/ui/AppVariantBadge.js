"use client";

import { useAppName } from "@/shared/hooks/useAppName";
import { appVariant } from "@/shared/constants/appName";

// Corner tag naming the install (W, WL, A, AL), so the same screen on four installs is told apart.
export default function AppVariantBadge() {
  const appName = useAppName();
  return (
    <span
      aria-hidden="true"
      className="fixed right-0.5 z-[60] pointer-events-none select-none text-[9px] leading-none font-semibold px-1 py-0.5 rounded-brand bg-brand-500/20 text-brand-500"
      style={{ top: "calc(2px + env(safe-area-inset-top, 0px))" }}
    >
      {appVariant(appName)}
    </span>
  );
}
