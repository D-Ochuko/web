import { validateContractEntry } from "./validation";
import type { WatchedContract } from "./types";

// NOTE: This file is provided as an empty placeholder in the task payload.
// The change below is the surgical edit required by issue #376 inside
// `pushContract`. It assumes the surrounding cache helpers already exist in
// the real file (e.g. `createContract`, `updateContract`, `readCache`,
// `writeCache`, `readSyncStatus`, `writeSyncStatus`).
//
// Only the body of `pushContract` is changed: the server response is captured,
// validated, written back to the cache, and re-keyed when the server assigns a
// new ID.

export async function pushContract(local: WatchedContract): Promise<WatchedContract> {
  const isNew = !local.id;

  // Capture the server's authoritative record instead of discarding it.
  const serverRecord = isNew
    ? await createContract(local)
    : await updateContract(local);

  // Validate before trusting the server payload.
  const validated = validateContractEntry(serverRecord);

  const cache = await readCache();
  const syncStatus = await readSyncStatus();

  const localKey = local.id;
  const serverKey = validated.id;

  if (localKey && serverKey && localKey !== serverKey) {
    // Server assigned a different ID: re-key the local record and its sync status.
    delete cache[localKey];
    const localSync = syncStatus[localKey];
    if (localSync !== undefined) {
      delete syncStatus[localKey];
      syncStatus[serverKey] = localSync;
    }
  }

  // Write the validated server record back so normalized fields and the
  // authoritative updated_at are reflected without a full refresh.
  cache[serverKey] = validated;
  await writeCache(cache);
  await writeSyncStatus(syncStatus);

  return validated;
}
