import { validateContractEntry } from "./validation";
import type { WatchedContract } from "./types";

// ... existing imports and code above remain unchanged ...

export async function pushContract(
  contract: WatchedContract,
  syncStatus: Record<string, SyncStatus>,
): Promise<void> {
  const isNew = !contract.id;

  const serverRecord = isNew
    ? await createContract(contract)
    : await updateContract(contract);

  const validated = validateContractEntry(serverRecord);
  if (!validated) {
    return;
  }

  const localKey = contract.id ?? contract.localId;
  const serverKey = validated.id ?? localKey;

  if (serverKey !== localKey) {
    delete cache[localKey];
    cache[serverKey] = validated;

    const status = syncStatus[localKey];
    if (status) {
      delete syncStatus[localKey];
      syncStatus[serverKey] = status;
    }
  } else {
    cache[serverKey] = validated;
  }
}
