# DroneDAA Project Context

## What This Is

**DroneDAA** (detectandavoid.com) is a React web app with iOS native wrapper for live drone flight tracking with Detect-and-Avoid (DAA) alerts. It shows FAA airspace polygons, live drone positions (via Remote ID), manned aircraft (via ADS-B), and weather — all on a MapKit JS map with a dark-themed side panel.

Built on a shared architecture with MapKit, Capacitor iOS, WeatherKit, auth, payments, and dark theme.

## Tech Stack

- **Frontend**: Vite + React + TypeScript (web/)
- **Backend**: Serverless API (api/)
- **iOS**: Capacitor 8 wrapper (web/ios/)
- **Deployment**: Vercel (web + API)
- **Map**: Apple MapKit JS (satellite + hybrid)
- **Weather**: Apple WeatherKit REST API
- **Auth**: Sign in with Apple (web + iOS native)
- **Payments**: StoreKit 2 (iOS IAP)

## Architecture

```
drone-daa/
├── web/
│   ├── src/
│   │   ├── App.tsx              # Map + side panel (Airspace/Weather/Flights/Settings)
│   │   ├── App.css              # Dark theme
│   │   ├── MapKitMap.tsx         # MapKit JS wrapper
│   │   ├── main.tsx             # React root with providers
│   │   ├── nav.ts               # Geo/nav utilities
│   │   ├── zones/index.ts       # Zone config (default area)
│   │   ├── services/
│   │   │   ├── airspace.ts      # FAA airspace polygons (stub)
│   │   │   ├── remoteId.ts      # Remote ID drone feeds (stub)
│   │   │   └── adsb.ts          # ADS-B aircraft feeds (stub)
│   │   ├── auth/                # Sign in with Apple
│   │   ├── store/               # StoreKit 2 IAP
│   │   ├── entitlements/        # Access control
│   │   ├── paywall/             # Premium feature paywalls (placeholder)
│   │   └── platform/            # iOS/web detection
│   ├── ios/                     # Capacitor iOS wrapper
│   │   └── App/App/Plugins/     # StoreKit + AppleSignIn native
│   └── package.json
├── api/
│   ├── shared/                  # db, jwt, apple, weatherkit
│   ├── auth/apple.js            # Sign in with Apple verification
│   ├── mapkit/token.js          # MapKit JS auth token
│   ├── me/                      # User entitlements + saved locations
│   ├── purchases/               # StoreKit verification
│   └── weather/index.js         # Generic weather (lat/lon)
├── package.json
└── vercel.json
```

## Build & Dev Commands

```bash
# Root level
npm run dev          # Run API + Web dev servers concurrently
npm run dev:api      # API only
npm run dev:web      # Web only

# Web directory (cd web/)
npm run dev          # Vite dev server (http://localhost:5173)
npm run build        # TypeScript compile + Vite build
npm run preview      # Preview production build

# iOS (from web/ directory)
npm run cap:sync     # Sync web build to iOS
npm run cap:build    # Build web + sync to iOS
npm run ios:open     # Open Xcode
npm run ios:run      # Build + launch iOS simulator
npm run ios:build    # Full build + open in Xcode
```

## Data Sources (To Integrate)

### FAA Airspace
- FAA UAS Data Exchange / LAANC
- Airspace classes B/C/D/E, TFRs, restricted/prohibited areas
- Service stub: `web/src/services/airspace.ts`

### Remote ID (Drone Tracking)
- FAA Remote ID broadcast standard
- Drone position, altitude, heading, speed, operator ID
- Service stub: `web/src/services/remoteId.ts`

### ADS-B (Manned Aircraft)
- ADS-B Exchange or OpenSky Network
- Aircraft position, callsign, altitude, speed
- Service stub: `web/src/services/adsb.ts`

### Weather
- Apple WeatherKit REST API
- Temperature, wind speed/direction/gusts, visibility, cloud cover
- Endpoint: `GET /api/weather?lat=X&lon=Y`

## API Endpoints

### Working
- GET /api/weather?lat=X&lon=Y — WeatherKit data for any coordinates
- GET /api/mapkit/token — MapKit JS authentication
- POST /api/auth/apple — Sign in with Apple verification
- GET /api/me/entitlements — User entitlements
- POST /api/purchases/ios/verify — StoreKit transaction verification

## Entitlement System

- Generic key-based: `hasEntitlement("pro")`, `hasEntitlement("premium")`
- Product IDs: `com.dronedaa.pass.<feature>.1y`
- SKU ↔ entitlement mapping in `entitlements/types.ts`

## Important Notes

- **Apple service IDs** (WeatherKit, MapKit) are configured via env vars (`MAPKIT_MAPS_ID`, `WEATHERKIT_SERVICE_ID`, `APPLE_CLIENT_ID`) — set these in Vercel for production
- **Mac required for iOS development**
- **Capacitor syncs web build to iOS** — write React, not Swift
- **Product IDs are forever** — once live, never change SKU names

## Code Style

- TypeScript strict mode
- Functional React components with hooks
- ES modules (import/export)
- Keep components small and focused
