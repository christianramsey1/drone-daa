// relay-app/src/tray.js — System tray icon and context menu

"use strict";

const { Tray, Menu, nativeImage, shell, app } = require("electron");
const path = require("node:path");

let tray = null;
let currentColor = "yellow";

function getIconPath(color) {
  const base = path.join(__dirname, "..", "assets", "icons");
  const suffix = process.platform === "darwin" ? "@2x" : "";
  const file = `tray-${color}${suffix}.png`;
  const fullPath = path.join(base, file);

  // Fall back to non-retina if @2x doesn't exist
  try {
    require("node:fs").accessSync(fullPath);
    return fullPath;
  } catch {
    return path.join(base, `tray-${color}.png`);
  }
}

function createTray() {
  const iconPath = getIconPath("yellow");
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("DroneDAA Relay — Starting...");
  rebuildMenu("Starting...");
}

function updateTrayStatus({ color, statusText }) {
  if (!tray) return;

  if (color !== currentColor) {
    currentColor = color;
    const iconPath = getIconPath(color);
    tray.setImage(nativeImage.createFromPath(iconPath));
  }

  tray.setToolTip(`DroneDAA Relay\n${statusText}`);
  rebuildMenu(statusText);
}

function rebuildMenu(statusText) {
  if (!tray) return;

  const statusLines = statusText.split("\n").map((line) => ({
    label: line,
    enabled: false,
  }));

  const menu = Menu.buildFromTemplate([
    { label: "DroneDAA Relay", enabled: false },
    { type: "separator" },
    ...statusLines,
    { type: "separator" },
    {
      label: "Open DroneDAA",
      click: () => shell.openExternal("http://localhost:4001"),
    },
    {
      label: "Open detectandavoid.com",
      click: () => shell.openExternal("https://detectandavoid.com"),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => app.quit(),
    },
  ]);

  tray.setContextMenu(menu);
}

module.exports = { createTray, updateTrayStatus };
