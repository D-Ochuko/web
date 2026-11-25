import {
  createContract,
  updateContract,
  validateContractEntry,
} from "./api";
import { getContract, putContract, deleteContract } from "./cache";
import {
  getSyncStatus,
  setSyncStatus,
  deleteSyncStatus,
} from "./syncStatus";
import type { WatchedContract } from "./types";

/**
 * Push a single local contract to the server, reconciling the authoritative
 * server response back into the local cache and sync status.
 */
export async function pushContract(local: WatchedContract): Promise<void> {
  const status = await getSyncStatus(local.id);
  if (!status || status.state === "synced") {
    return;
  }

  let serverRecord: WatchedContract | undefined;

  if (status.state === "created") {
    serverRecord = await createContract(local);
  } else if (status.state === "updated") {
    serverRecord = await updateContract(local);
  } else if (status.state === "deleted") {
    await deleteContract(local.id);
    await deleteSyncStatus(local.id);
    return;
  }

  if (!serverRecord) {
    return;
  }

  const validated = validateContractEntry(serverRecord);
  if (!validated) {
    return;
  }

  const serverId = validated.id;

  if (serverId !== local.id) {
    // Server assigned a new ID: re-key the local record and its sync status.
    await deleteContract(local.id);
    await putContract(validated);
    await deleteSyncStatus(local.id);
    await setSyncStatus(serverId, { state: "synced" });
  } else {
    await putContract(validated);
    await setSyncStatus(serverId, { state: "synced" });
  }
}
