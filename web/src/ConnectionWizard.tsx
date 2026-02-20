// web/src/ConnectionWizard.tsx — Setup wizard for relay connection

import { useMemo } from "react";
import { detectDesktopOS, getRelayDownloadUrl, getOSLabel } from "./services/platformDetect";
import type { AdsbConnectionStatus } from "./services/useAdsb";

type WizardProps = {
  adsbStatus: AdsbConnectionStatus;
  adsbReceiverConnected: boolean;
  adsbCount: number;
  onDismiss: () => void;
  onOpenHowTo: () => void;
};

export function ConnectionWizard({
  adsbStatus,
  adsbReceiverConnected,
  adsbCount,
  onDismiss,
  onOpenHowTo,
}: WizardProps) {
  const os = useMemo(() => detectDesktopOS(), []);
  const downloadUrl = useMemo(() => getRelayDownloadUrl(os), [os]);
  const osLabel = useMemo(() => getOSLabel(os), [os]);

  // Only count as connected once the WebSocket is actually open.
  // "connecting" is a transient reconnect attempt — don't flash green.
  const relayConnected = adsbStatus === "connected" || adsbStatus === "receiving";

  const steps: StepDef[] = [
    {
      title: "Download DroneDAA Relay",
      description: relayConnected
        ? "Relay app installed."
        : `Download the relay app for ${osLabel}. It runs as a small icon in your ${os === "mac" ? "menu bar" : "system tray"}.`,
      done: relayConnected,
      active: !relayConnected,
      content: !relayConnected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="chipBtn"
            style={{ display: "inline-block", textDecoration: "none", textAlign: "center" }}
          >
            Download for {osLabel}
          </a>
          {os === "linux" && (
            <p className="smallMuted">
              Linux: install Node.js 18+ and run <code>node relay/start.js</code> from the repo.
            </p>
          )}
          {os === "unknown" && (
            <p className="smallMuted">
              Or run manually: <code>node relay/start.js</code> (requires Node.js 18+)
            </p>
          )}
        </div>
      ) : undefined,
    },
    {
      title: "Run the Relay App",
      description: relayConnected
        ? "Relay connected."
        : os === "mac"
          ? "Open the .dmg and drag DroneDAA Relay to Applications. Launch it — look for the colored dot in your menu bar."
          : "Run the installer and launch DroneDAA Relay. Look for the colored dot in your system tray.",
      done: relayConnected,
      active: !relayConnected,
    },
    {
      title: "Connect ADS-B Receiver",
      description: adsbReceiverConnected
        ? "Receiver streaming data."
        : "Power on your GDL-90 receiver and connect this device to the receiver's WiFi hotspot. Note: the receiver hotspot may not provide internet access — download offline maps first if needed.",
      done: adsbReceiverConnected,
      active: relayConnected && !adsbReceiverConnected,
    },
    {
      title: "Verify Data Flow",
      description: adsbCount > 0
        ? `Receiving ${adsbCount} aircraft.`
        : "Once aircraft are in range, they will appear on the map. The relay tray icon turns green when data is flowing.",
      done: adsbCount > 0,
      active: adsbReceiverConnected && adsbCount === 0,
    },
  ];

  return (
    <div className="panelSection">
      <div className="sectionTitle">Setup Guide</div>
      <p className="smallMuted">
        {relayConnected
          ? "Relay is running. Connect your ADS-B receiver to start tracking aircraft."
          : "DroneDAA needs a local relay app to receive ADS-B and Remote ID data from your hardware."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
        {steps.map((step, i) => (
          <WizardStep key={i} stepNumber={i + 1} {...step} />
        ))}
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
        <button className="chipBtn compact" onClick={onDismiss}>
          {relayConnected ? "Dismiss" : "Skip for now"}
        </button>
        <button className="linkBtn" style={{ fontSize: 11 }} onClick={onOpenHowTo}>
          Full instructions
        </button>
      </div>
    </div>
  );
}

type StepDef = {
  title: string;
  description: string;
  done: boolean;
  active: boolean;
  content?: React.ReactNode;
};

function WizardStep({ stepNumber, title, description, done, active, content }: StepDef & { stepNumber: number }) {
  const indicatorColor = done
    ? "#30d158"
    : active
      ? "#00d1ff"
      : "rgba(255,255,255,0.15)";

  const indicatorText = done ? "\u2713" : String(stepNumber);
  const textColor = done || active ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)";

  return (
    <div className="kv" style={{
      borderColor: active ? "rgba(0, 209, 255, 0.3)" : done ? "rgba(48, 209, 88, 0.2)" : undefined,
      opacity: !done && !active ? 0.5 : 1,
      transition: "opacity 0.3s, border-color 0.3s",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          className={active ? "wizardPulse" : undefined}
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            background: indicatorColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            color: done || active ? "#000" : "rgba(255,255,255,0.4)",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          {indicatorText}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: textColor }}>{title}</div>
          <div className="smallMuted" style={{ marginTop: 2 }}>{description}</div>
        </div>
      </div>
      {content && active && (
        <div style={{ marginTop: 8, marginLeft: 34 }}>
          {content}
        </div>
      )}
    </div>
  );
}
