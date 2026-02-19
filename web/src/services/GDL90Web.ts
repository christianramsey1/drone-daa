// web/src/services/GDL90Web.ts
// Web fallback for the GDL90 Capacitor plugin — returns empty state.
// On web, ADS-B data comes via WebSocket relay, not native UDP.

import { WebPlugin } from "@capacitor/core";
import type { GDL90PluginInterface, GDL90Snapshot } from "./GDL90Plugin";

export class GDL90Web extends WebPlugin implements GDL90PluginInterface {
  async startListening(): Promise<{ started: boolean }> {
    return { started: false };
  }

  async stopListening(): Promise<void> {}

  async getSnapshot(): Promise<GDL90Snapshot> {
    return {
      receiverConnected: false,
      gpsValid: false,
      ownship: null,
      aircraft: [],
      count: 0,
      timestamp: Date.now(),
    };
  }
}
