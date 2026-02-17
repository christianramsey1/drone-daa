/**
 * Apple Sign In Button
 *
 * A styled button that triggers Sign in with Apple.
 * Follows Apple's Human Interface Guidelines for the button design.
 */

import { useAuth } from "./AuthContext";

type Props = {
  onSuccess?: () => void;
  onError?: (error: string) => void;
  variant?: "black" | "white";
  size?: "small" | "medium" | "large";
};

export function AppleSignInButton({
  onSuccess,
  onError,
  variant = "black",
  size = "medium",
}: Props) {
  const { signIn, loading, isAppleSignInReady } = useAuth();

  const handleClick = async () => {
    try {
      await signIn();
      onSuccess?.();
    } catch (err: any) {
      onError?.(err?.message || "Sign in failed");
    }
  };

  const heights = {
    small: 32,
    medium: 44,
    large: 56,
  };

  const fontSizes = {
    small: 13,
    medium: 16,
    large: 18,
  };

  const height = heights[size];
  const fontSize = fontSizes[size];

  const isBlack = variant === "black";

  return (
    <button
      onClick={handleClick}
      disabled={loading || !isAppleSignInReady}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        width: "100%",
        height,
        padding: "0 16px",
        borderRadius: 8,
        border: isBlack ? "none" : "1px solid #000",
        background: isBlack ? "#000" : "#fff",
        color: isBlack ? "#fff" : "#000",
        fontSize,
        fontWeight: 500,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        cursor: loading || !isAppleSignInReady ? "wait" : "pointer",
        opacity: loading || !isAppleSignInReady ? 0.6 : 1,
        transition: "opacity 150ms ease",
      }}
    >
      {/* Apple Logo SVG */}
      <svg
        width={fontSize * 1.2}
        height={fontSize * 1.2}
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
      </svg>
      <span>{loading ? "Signing in..." : "Sign in with Apple"}</span>
    </button>
  );
}
