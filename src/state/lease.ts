import type { BridgeStoreData } from "../types.js";

export class LeaseManager {
  constructor(
    private readonly instanceID: string,
    private readonly now: () => number,
    private readonly ttlMs: number,
  ) {}

  claim(store: BridgeStoreData): BridgeStoreData {
    const current = store.lease;
    if (!current) {
      return this.writeLease(store);
    }
    if (current.ownerInstanceID === this.instanceID) {
      return this.writeLease(store);
    }
    if (this.now() - current.ownerHeartbeatAt > this.ttlMs) {
      return this.writeLease(store);
    }
    throw new Error(
      `Bridge already owned by another OpenCode instance (${current.ownerInstanceID}).`,
    );
  }

  refresh(store: BridgeStoreData): BridgeStoreData {
    const current = store.lease;
    if (!current) {
      return store;
    }
    if (current.ownerInstanceID !== this.instanceID) {
      throw new Error("Cannot refresh lease that is owned by another instance.");
    }
    return this.writeLease(store);
  }

  release(store: BridgeStoreData): BridgeStoreData {
    if (!store.lease) return store;
    if (store.lease.ownerInstanceID !== this.instanceID) return store;
    return {
      ...store,
      lease: undefined,
    };
  }

  isOwner(store: BridgeStoreData): boolean {
    return store.lease?.ownerInstanceID === this.instanceID;
  }

  private writeLease(store: BridgeStoreData): BridgeStoreData {
    return {
      ...store,
      lease: {
        ownerInstanceID: this.instanceID,
        ownerHeartbeatAt: this.now(),
      },
    };
  }
}

