#!/usr/bin/env node
// relay/start.js — Combined DroneDAA relay launcher
// Starts both ADS-B (GDL90) and Remote ID relay services.
// Run with: node relay/start.js
//
// Services:
//   ADS-B:  UDP 4000 (GDL90 input) → WS 4001 (JSON snapshots)
//   RID:    BLE scan + HTTP 4003 (ingest) → WS 4002 (JSON snapshots)

/* eslint-disable no-console */
"use strict";

console.log("╔══════════════════════════════════════════════╗");
console.log("║          DroneDAA Relay Server               ║");
console.log("╠══════════════════════════════════════════════╣");
console.log("║  ADS-B:  GDL90 UDP :4000 → WS :4001         ║");
console.log("║  RID:    BLE scan + HTTP :4003 → WS :4002    ║");
console.log("╚══════════════════════════════════════════════╝");
console.log();

// Start ADS-B relay
require("./index.js");

// Start RID relay
require("./rid.js");
