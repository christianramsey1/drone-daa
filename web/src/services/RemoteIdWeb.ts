// web/src/services/RemoteIdWeb.ts
// Web fallback for the RemoteId Capacitor plugin — returns empty state.
// On web, RID data comes via BLE scan API or WebSocket relay.

import { WebPlugin } from "@capacitor/core";
import type { RemoteIdPluginInterface } from "./RemoteIdPlugin";
import type { RidSnapshot } from "./remoteId";

export class RemoteIdWeb extends WebPlugin implements RemoteIdPluginInterface {
  async startScanning(): Promise<{ started: boolean }> {
    return { started: false };
  }

  async stopScanning(): Promise<void> {}

  async getSnapshot(): Promise<RidSnapshot> {
    return {
      type: "rid-snapshot",
      timestamp: Date.now(),
      drones: [],
      count: 0,
      scanning: false,
    };
  }
}
