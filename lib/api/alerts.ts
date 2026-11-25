import type { Network } from "@/lib/types";

export interface AlertSubscription {
  contractId: string;
  network: Network;
}

export interface AlertEvent {
  contractId: string;
  network: Network;
  id: string;
  createdAt: string;
  [key: string]: unknown;
}

const BASE_POLL_INTERVAL_MS = 30_000;
const JITTER_RATIO = 0.2;

/**
 * Returns the next poll delay in ms with ±20% random jitter applied so that
 * many watched contracts (and many clients) do not poll in lock-step.
 */
export function nextPollDelay(baseMs: number = BASE_POLL_INTERVAL_MS): number {
  const jitter = (Math.random() * 2 - 1) * JITTER_RATIO;
  return Math.round(baseMs * (1 + jitter));
}

function contractKey(sub: AlertSubscription): string {
  return `${sub.contractId}:${sub.network}`;
}

function buildBatchUrl(subs: AlertSubscription[], since?: string): string {
  const contracts = subs.map(contractKey).join(",");
  const params = new URLSearchParams({ contracts });
  if (since) params.set("since", since);
  return `/alerts?${params.toString()}`;
}

function buildSingleUrl(sub: AlertSubscription, since?: string): string {
  const params = new URLSearchParams({
    contract: sub.contractId,
    network: sub.network,
  });
  if (since) params.set("since", since);
  return `/alerts?${params.toString()}`;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Alert request failed (${res.status}): ${url}`);
  }
  return (await res.json()) as T;
}

/**
 * Fetches alerts for many contracts in a single request using the assumed
 * core route `GET /alerts?contracts=<id:net,…>&since=`. If the batched route
 * is unavailable or fails, falls back to per-contract requests so a single
 * contract failure does not drop the rest.
 */
export async function fetchAlerts(
  subs: AlertSubscription[],
  since?: string,
  signal?: AbortSignal,
): Promise<AlertEvent[]> {
  if (subs.length === 0) return [];

  if (subs.length > 1) {
    try {
      const batched = await fetchJson<AlertEvent[]>(buildBatchUrl(subs, since), signal);
      if (Array.isArray(batched)) return batched;
    } catch {
      // Assumed core route may not exist yet; fall through to per-contract.
    }
  }

  const results = await Promise.allSettled(
    subs.map((sub) => fetchJson<AlertEvent[]>(buildSingleUrl(sub, since), signal)),
  );

  return results.flatMap((r) => (r.status === "fulfilled" && Array.isArray(r.value) ? r.value : []));
}
