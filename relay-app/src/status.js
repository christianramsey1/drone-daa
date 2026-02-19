// relay-app/src/status.js — Status aggregation for tray icon

"use strict";

/**
 * Compute tray icon color and status text from relay module states.
 *
 * Green:  at least one service receiving real data
 * Yellow: services running but no receiver/drone data
 * Red:    both services failed
 */
function computeStatus(adsbStatus, ridStatus) {
  const adsbFailed = !adsbStatus || adsbStatus.trackCount === undefined;
  const ridFailed = !ridStatus || ridStatus.droneCount === undefined;

  // Determine color
  let color;
  if (adsbFailed && ridFailed) {
    color = "red";
  } else if (adsbStatus.receiverConnected || ridStatus.droneCount > 0) {
    color = "green";
  } else {
    color = "yellow";
  }

  // Build status text lines
  const lines = [];

  if (adsbFailed) {
    lines.push("ADS-B: Error");
  } else if (adsbStatus.receiverConnected) {
    lines.push(
      `ADS-B: ${adsbStatus.trackCount} aircraft` +
      (adsbStatus.gpsValid ? " (GPS fix)" : " (no GPS)")
    );
  } else {
    lines.push("ADS-B: Waiting for receiver (UDP 4000)");
  }

  if (ridFailed) {
    lines.push("RID: Error");
  } else if (ridStatus.droneCount > 0) {
    lines.push(`RID: ${ridStatus.droneCount} drones`);
  } else if (ridStatus.scanning) {
    lines.push("RID: Scanning" + (ridStatus.bleAvailable ? " (BLE)" : ""));
  } else {
    lines.push("RID: Idle");
  }

  // Client count
  const totalClients = (adsbStatus.clientCount ?? 0) + (ridStatus.clientCount ?? 0);
  if (totalClients > 0) {
    lines.push(`${totalClients} web client${totalClients !== 1 ? "s" : ""} connected`);
  }

  return {
    color,
    statusText: lines.join("\n"),
  };
}

module.exports = { computeStatus };
