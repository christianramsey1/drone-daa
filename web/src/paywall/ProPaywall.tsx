/**
 * ProPaywall
 *
 * Full-screen modal shown when a user tries to access a Pro feature.
 * Highlights skyAlert ↔ app alert synchronization as the headline feature.
 */

import { useStore } from "../store/useStore";
import { useAuth } from "../auth/AuthContext";
import { isNative } from "../platform";

type Props = {
  onClose: () => void;
};

const FEATURES = [
  {
    icon: "🗺️",
    title: "FAA Airspace Layers",
    desc: "Display Class B/C/D/E airspace, TFRs, restricted and prohibited areas, and obstructions directly on the map.",
  },
  {
    icon: "📥",
    title: "Downloadable Offline Maps",
    desc: "Download topo map tiles and FAA airspace layers for your area and fly without any internet connection.",
  },
  {
    icon: "📡",
    title: "skyAlert Device Controls",
    desc: "Sync caution and warning alert thresholds directly to your skyAlert proximity alarm. Adjust range, altitude limit, volume, and LED brightness — plus set your ICAO address, test the alarm, and reset to factory defaults — all without opening a browser.",
  },
];

export function ProPaywall({ onClose }: Props) {
  const store = useStore();
  const { isAuthenticated } = useAuth();

  const proProduct = store.getProduct("pro");
  const priceLabel = proProduct?.displayPrice ?? "$19.99";

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.85)",
      backdropFilter: "blur(12px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={onClose}>
      <div
        style={{
          width: "100%", maxWidth: 480,
          background: "linear-gradient(180deg, #1a0a0a 0%, #0d0d0d 100%)",
          borderRadius: "20px 20px 0 0",
          border: "1px solid rgba(228, 0, 43, 0.25)",
          borderBottom: "none",
          padding: "24px 20px 40px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div style={{
          width: 36, height: 4, borderRadius: 2,
          background: "rgba(255,255,255,0.2)",
          margin: "0 auto 20px",
        }} />

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="56" height="56" style={{ borderRadius: 14, marginBottom: 12 }}>
            <defs>
              <radialGradient id="pwBg" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#001a0e"/>
                <stop offset="100%" stopColor="#000a06"/>
              </radialGradient>
              <radialGradient id="pwGlow" cx="50%" cy="50%" r="35%">
                <stop offset="0%" stopColor="#00ff64" stopOpacity="0.18"/>
                <stop offset="100%" stopColor="#00ff64" stopOpacity="0"/>
              </radialGradient>
            </defs>
            <rect width="1024" height="1024" rx="224" ry="224" fill="url(#pwBg)"/>
            <circle cx="512" cy="512" r="460" fill="url(#pwGlow)"/>
            <circle cx="512" cy="512" r="150" fill="none" stroke="#00ff64" strokeWidth="5" strokeOpacity="0.22"/>
            <circle cx="512" cy="512" r="300" fill="none" stroke="#00ff64" strokeWidth="5" strokeOpacity="0.18"/>
            <circle cx="512" cy="512" r="430" fill="none" stroke="#00ff64" strokeWidth="5" strokeOpacity="0.13"/>
            <line x1="472" y1="472" x2="358" y2="358" stroke="#00ff64" strokeWidth="18" strokeOpacity="0.8" strokeLinecap="round"/>
            <line x1="552" y1="472" x2="666" y2="358" stroke="#00ff64" strokeWidth="18" strokeOpacity="0.8" strokeLinecap="round"/>
            <line x1="472" y1="552" x2="358" y2="666" stroke="#00ff64" strokeWidth="18" strokeOpacity="0.8" strokeLinecap="round"/>
            <line x1="552" y1="552" x2="666" y2="666" stroke="#00ff64" strokeWidth="18" strokeOpacity="0.8" strokeLinecap="round"/>
            <rect x="468" y="468" width="88" height="88" rx="14" fill="#00ff64" fillOpacity="0.88"/>
            <circle cx="334" cy="334" r="52" fill="none" stroke="#00ff64" strokeWidth="12" strokeOpacity="0.72"/>
            <circle cx="690" cy="334" r="52" fill="none" stroke="#00ff64" strokeWidth="12" strokeOpacity="0.72"/>
            <circle cx="334" cy="690" r="52" fill="none" stroke="#00ff64" strokeWidth="12" strokeOpacity="0.72"/>
            <circle cx="690" cy="690" r="52" fill="none" stroke="#00ff64" strokeWidth="12" strokeOpacity="0.72"/>
            <circle cx="334" cy="334" r="10" fill="#00ff64" fillOpacity="0.7"/>
            <circle cx="690" cy="334" r="10" fill="#00ff64" fillOpacity="0.7"/>
            <circle cx="334" cy="690" r="10" fill="#00ff64" fillOpacity="0.7"/>
            <circle cx="690" cy="690" r="10" fill="#00ff64" fillOpacity="0.7"/>
            <circle cx="760" cy="196" r="22" fill="#ff3b30" fillOpacity="0.95"/>
            <circle cx="760" cy="196" r="40" fill="none" stroke="#ff3b30" strokeWidth="6" strokeOpacity="0.45"/>
            <circle cx="512" cy="512" r="452" fill="none" stroke="#00ff64" strokeWidth="8" strokeOpacity="0.32"/>
          </svg>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
            DroneDAA Pro
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
            FAA airspace layers, offline maps, and full<br />
            skyAlert device control — synchronized with DroneDAA.
          </div>
        </div>

        {/* Feature list */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              display: "flex", gap: 12, alignItems: "flex-start",
              padding: "10px 12px", borderRadius: 10,
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
            }}>
              <div style={{ fontSize: 18, lineHeight: 1, marginTop: 1 }}>{f.icon}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.9)", marginBottom: 2 }}>{f.title}</div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.4 }}>{f.desc}</div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        {isAuthenticated ? (
          <>
            <button
              style={{
                width: "100%", padding: "14px 0", borderRadius: 12,
                background: "#e4002b", border: "none",
                fontSize: 16, fontWeight: 700, color: "#fff",
                cursor: store.purchasing ? "default" : "pointer",
                opacity: store.purchasing ? 0.6 : 1,
                marginBottom: 10,
              }}
              disabled={store.purchasing}
              onClick={async () => {
                const success = await store.purchasePass("pro");
                if (success) onClose();
              }}
            >
              {store.purchasing ? "Processing…" : `Subscribe — ${priceLabel}/year`}
            </button>
            {isNative() && (
              <button
                style={{
                  width: "100%", padding: "10px 0", borderRadius: 12,
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.12)",
                  fontSize: 13, color: "rgba(255,255,255,0.5)",
                  cursor: store.restoring ? "default" : "pointer",
                }}
                disabled={store.restoring}
                onClick={async () => {
                  const success = await store.restorePurchases();
                  if (success) onClose();
                }}
              >
                {store.restoring ? "Restoring…" : "Restore Subscription"}
              </button>
            )}
          </>
        ) : (
          <div style={{
            textAlign: "center", padding: "14px",
            borderRadius: 12, background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            fontSize: 13, color: "rgba(255,255,255,0.5)",
          }}>
            Sign in with Apple to unlock Pro features.
          </div>
        )}

        {store.error && (
          <p style={{ marginTop: 10, fontSize: 11, color: "#ff453a", textAlign: "center" }}>
            {store.error}
          </p>
        )}

        <p style={{ marginTop: 12, fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", lineHeight: 1.5 }}>
          Auto-renewable subscription. {priceLabel}/year. Payment is charged to your Apple ID account at confirmation of purchase.
          Subscription automatically renews unless canceled at least 24 hours before the end of the current period.
          Your account will be charged for renewal within 24 hours prior to the end of the current period.
          Manage or cancel subscriptions in your Apple ID account settings.
          <br />
          <a href="https://detectandavoid.com/terms" target="_blank" rel="noopener" style={{ color: "rgba(255,255,255,0.4)" }}>Terms of Service</a>
          {" · "}
          <a href="https://detectandavoid.com/privacy" target="_blank" rel="noopener" style={{ color: "rgba(255,255,255,0.4)" }}>Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
