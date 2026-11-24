"use client";

import { useEffect, useState } from "react";
import { useTerminalStore } from "@/shared/stores/terminalStore";
import { useFleetStore } from "@/shared/stores/fleetStore";
import { AGENT_CLIS_TTL_MS, AGENT_CLIS_RETRY_MS, AGENT_CLIS_MAX_RETRIES } from "@/features/terminal/constants/terminalConfig";

// TUI agent CLIs detected on the host's PATH, cached per host in the terminal
// store. Fetches when a modal mounts and that host's cache is stale/empty.
export function useAgentClis(busRef, hostKey = "main") {
  // "main" is a sentinel some callers still pass — cache under the real current
  // head so every modal and the layout's warm-keeper share ONE slot per machine.
  const key = hostKey && hostKey !== "main" ? hostKey : (useFleetStore.getState().currentKey || "main");
  const agentClis = useTerminalStore((s) => s.agentClisBy[key]?.list);
  // A lazy bus opens after mount — the status flip is what retriggers the fetch.
  const hostStatus = useFleetStore((s) => s.hosts[key]?.status || null);

  // A request made before the bus is ready is lost without a reply (the modal then showed no
  // agents at all), so an unanswered one is sent again a few times.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const entry = useTerminalStore.getState().agentClisBy[key];
    if (entry && Date.now() - entry.at < AGENT_CLIS_TTL_MS) return;
    let answered = false;
    busRef?.current?.emit("getAgentClis", (result) => {
      const agents = Array.isArray(result?.agents) ? result.agents : (Array.isArray(result) ? result : null);
      if (!agents) return;
      answered = true;
      useTerminalStore.getState().setAgentClis(key, agents);
    });
    if (attempt >= AGENT_CLIS_MAX_RETRIES) return;
    const retry = setTimeout(() => { if (!answered) setAttempt((n) => n + 1); }, AGENT_CLIS_RETRY_MS);
    return () => clearTimeout(retry);
  }, [busRef, key, hostStatus, attempt]);

  return agentClis;
}
