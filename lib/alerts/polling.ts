/**
 * Alert polling helpers.
 *
 * Each watched contract is polled on its own loop. To avoid all clients and
 * contracts firing in lock-step (thundering herd after a core outage), the
 * poll delay is jittered by ±20%.
 *
 * Batched polling uses an *assumed* core route:
 *   GET /alerts?contracts=<id:net,…>&since=<iso>
 * If that route is unavailable or fails, callers fall back to per-contract
 * requests via `fetchAlertsPerContract`.
 */

export const BASE_POLL_INTERVAL_MS = 30_000;
export const JITTER_RATIO = 0.2;

export interface WatchedContract {
  id: string;
  network: string;
}

export interface AlertRecord {
  contractId: string;
  network: string;
  [key: string]: unknown;
}

/**
 * Apply ±20% random jitter to a base delay.
 * Result is always within [base * 0.8, base * 1.2].
 */
export function nextPollDelay(
  baseMs: number = BASE_POLL_INTERVAL_MS,
  random: () => number = Math.random,
): number {
  const spread = baseMs * JITTER_RATIO;
  // random() in [0, 1) -> offset in [-spread, +spread)
  const offset = (random() * 2 - 1) * spread;
  return Math.round(baseMs + offset);
}

/** Build the assumed batched core route URL. */
export function buildBatchAlertsUrl(
  contracts: WatchedContract[],
  since: string,
  baseUrl = "",
): string {
  const ids = contracts.map((c) => `${c.id}:${c.network}`).join(",");
  const params = new URLSearchParams({ contracts: ids, since });
  return `${baseUrl}/alerts?${params.toString()}`;
}

/** Build a per-contract alerts URL (fallback path). */
export function buildContractAlertsUrl(
  contract: WatchedContract,
  since: string,
  baseUrl = "",
): string {
  const params = new URLSearchParams({
    contracts: `${contract.id}:${contract.network}`,
    since,
  });
  return `${baseUrl}/alerts?${params.toString()}`;
}

async function fetchAlerts(url: string, signal?: AbortSignal): Promise<AlertRecord[]> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`alerts request failed: ${res.status}`);
  }
  return (await res.json()) as AlertRecord[];
}

/**
 * Fetch alerts for a single contract. Used as the per-contract fallback when
 * the batched route is unavailable or fails.
 */
export async function fetchAlertsPerContract(
  contracts: WatchedContract[],
  since: string,
  baseUrl = "",
  signal?: AbortSignal,
): Promise<AlertRecord[]> {
  const results = await Promise.all(
    contracts.map((c) => fetchAlerts(buildContractAlertsUrl(c, since, baseUrl), signal)),
  );
  return results.flat();
}

/**
 * Fetch alerts for all watched contracts in one batched request, falling back
 * to per-contract requests if the batched route is unavailable or fails.
 */
export async function fetchAlerts(
  contracts: WatchedContract[],
  since: string,
  baseUrl = "",
  signal?: AbortSignal,
): Promise<AlertRecord[]> {
  if (contracts.length === 0) return [];
  if (contracts.length === 1) {
    return fetchAlertsPerContract(contracts, since, baseUrl, signal);
  }
  try {
    return await fetchAlerts(buildBatchAlertsUrl(contracts, since, baseUrl), signal);
  } catch {
    return fetchAlertsPerContract(contracts, since, baseUrl, signal);
  }
}
