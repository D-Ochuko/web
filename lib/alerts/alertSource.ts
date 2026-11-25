import { getAlerts } from "./alertStore";
import type { Alert, AlertNetwork } from "./types";

export interface AlertSource {
  fetchAlerts(contractId: string, network: AlertNetwork, since?: number): Promise<Alert[]>;
}

export interface SyncAlertsOptions {
  contractId: string;
  network: AlertNetwork;
  source: AlertSource;
  onAlerts?: (alerts: Alert[]) => void;
}

/**
 * Returns the most recent alert timestamp for a given contract on a specific
 * network. The cursor must be network-scoped: the same contract ID can be
 * watched on multiple networks, and a recent alert on one network must not
 * advance the cursor for another.
 */
export function getSinceCursor(contractId: string, network: AlertNetwork): number | undefined {
  const localAlerts = getAlerts(contractId).filter((alert) => alert.network === network);

  if (localAlerts.length === 0) {
    return undefined;
  }

  return localAlerts.reduce((max, alert) => Math.max(max, alert.timestamp), 0);
}

export async function syncAlerts({
  contractId,
  network,
  source,
  onAlerts,
}: SyncAlertsOptions): Promise<Alert[]> {
  const since = getSinceCursor(contractId, network);

  const fetched = await source.fetchAlerts(contractId, network, since);

  if (fetched.length > 0 && onAlerts) {
    onAlerts(fetched);
  }

  return fetched;
}
