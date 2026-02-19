// web/src/services/GDL90Plugin.ts
// Capacitor plugin interface for native UDP GDL90 reception (iOS)
// On web, falls back to stub — web uses WebSocket relay instead.

import { registerPlugin } from "@capacitor/core";
import type { AircraftTrack } from "./adsb";

export interface GDL90Snapshot {
  receiverConnected: boolean;
  gpsValid: boolean;
  ownship: AircraftTrack | null;
  aircraft: AircraftTrack[];
  count: number;
  timestamp: number;
}

export interface GDL90PluginInterface {
  startListening(options: {
    port: number;
    host?: string;
  }): Promise<{ started: boolean }>;

  stopListening(): Promise<void>;

  getSnapshot(): Promise<GDL90Snapshot>;
}

export const GDL90 = registerPlugin<GDL90PluginInterface>("GDL90", {
  web: () => import("./GDL90Web").then((m) => new m.GDL90Web()),
});
