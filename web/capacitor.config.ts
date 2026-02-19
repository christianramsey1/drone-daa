import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dronedaa.app",
  appName: "DroneDAA",
  webDir: "dist",
  server: {
    // For local dev with live reload, uncomment the next two lines and run `npm run dev`:
    // url: "http://localhost:5173",
    // cleartext: true,
    //
    // When commented out, the app loads from the built files in webDir (dist/)
    // Run `npm run build` then `npx cap sync` before launching the simulator

    // Allow fetch requests to the production API from capacitor://localhost
    allowNavigation: ["detectandavoid.com", "*.detectandavoid.com"],
  },
  ios: {
    // Use WKWebView (default, required for App Store)
    contentInset: "automatic",
    // Allow scrolling behavior
    scrollEnabled: true,
    // Prefer native keyboard over web keyboard
    preferredContentMode: "mobile",
    // Background modes if needed later
    // backgroundColor: "#000000",
  },
  plugins: {
    CapacitorHttp: {
      // Route fetch() through native iOS networking instead of WKWebView.
      // This bypasses CORS restrictions for API calls to detectandavoid.com.
      enabled: true,
    },
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: "#1c1c1e",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: "dark",
      backgroundColor: "#1c1c1e",
    },
    Keyboard: {
      resize: "body",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
