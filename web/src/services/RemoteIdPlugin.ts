// web/src/services/RemoteIdPlugin.ts
// Capacitor plugin interface for native CoreBluetooth RID scanning (iOS)
// On web, falls back to stub — web uses BLE scan API or WebSocket relay.

import { registerPlugin } from "@capacitor/core";
import type { RidSnapshot } from "./remoteId";

export interface RemoteIdPluginInterface {
  startScanning(): Promise<{ started: boolean }>;
  stopScanning(): Promise<void>;
  getSnapshot(): Promise<RidSnapshot>;
}

export const RemoteIdNative = registerPlugin<RemoteIdPluginInterface>("RemoteId", {
  web: () => import("./RemoteIdWeb").then((m) => new m.RemoteIdWeb()),
});
