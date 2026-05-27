# whatsnearby

whatsnearby is a React + Firebase web app for discovering, pinning, and navigating to nearby community locations on interactive maps.

It includes a professional landing experience, map category tiles, mobile-responsive UI, authentication for secure pin updates, and community-focused map data.

## Available Features

- Professional landing page with:
  - hero section, feature cards, stats, workflow section, trust section, footer
  - map category cards (Loo Finder + placeholder categories)
  - live mini map sneak preview centered on user location
- URL-based entry for map view:
  - `/` for landing
  - `/loo-finder-map` when map is opened
- Map experience:
  - full-viewport map canvas with floating UI chrome
  - desktop controls in top chrome + mobile docked controls near the bottom
  - current user location marker
  - click map / pin-at-center flow for adding locations
  - anchored smart popup form (auto-positioned to stay visible)
  - mobile-responsive bottom-sheet form behavior
  - center-screen branded loading overlay while map pins are fetched
  - bottom toast-style notices for errors/warnings/route info (instead of top bars)
  - dark mode toggle (persisted in local storage)
  - greener light map style + dark map style
- Pin data capture:
  - location name (auto-filled by reverse geocoding, editable)
  - nearby landmarks (auto-filled, editable)
  - rating (1-5)
  - price and free checkbox
  - details
- Validation and safeguards:
  - block pinning on likely sea/lake/river/island clicks
  - user-facing form validation
  - local fallback when cloud sync fails
- Routing:
  - "Get Directions" from user location to a pin via **TomTom Routing** (Maps SDK)
  - route line on the map + distance/time summary
- Authentication:
  - login/signup modal (Firebase Auth)
  - logout support
  - pin updates require authenticated user (pin owner, or admin for legacy pins)
- Admin moderation (Firestore `admins/{uid}` document):
  - admins see **Verify data** and **Delete pin** on map popups
  - only admins can set `verified` / delete documents (enforced in `firestore.rules`)
- Firestore sync:
  - realtime snapshot updates from `loos` collection
  - optimistic local pin display while sync happens
- **CSV import (restaurants & cafés):** on the Restaurants & Cafe or community map, use **Import CSV** to paste rows (`name, address, rating, reviews, category, phone` — same shape as a Google Sheet export). The app geocodes addresses with **OpenStreetMap Nominatim** (throttled) and saves to the `restaurants_cafes` collection. Requires Firebase.

## Tech Stack

- React (functional components + hooks)
- Firebase Firestore
- Firebase Authentication
- **TomTom Maps SDK for JavaScript** (`@tomtom-org/maps-sdk`) — map display + routing
- Leaflet on the landing-page preview map only
- Nominatim reverse geocoding (pin placement / CSV import)

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill `.env` with your Firebase Web app config values and a **TomTom API key** (`VITE_TOMTOM_API_KEY` from [TomTom Developer](https://developer.tomtom.com/)).

   Enable **Map Display**, **Routing**, and **Traffic** APIs for that key (traffic flow + incidents on the map).

4. In Firebase Console:
   - Enable **Firestore Database**
   - Enable **Authentication** (Email/Password provider)
   - (Optional) Enable Storage only if you plan to add image uploads back later

5. Deploy Firestore security rules from this repo (recommended):

   ```bash
   firebase deploy --only firestore:rules
   ```

   Rules live in `firestore.rules`. For a quick local experiment only, you may temporarily use permissive rules in the Firebase console—**do not** ship that to production.

6. **Admin accounts:** create `admins/{uid}` in Firestore (`{uid}` = the user’s Firebase Auth UID). Easiest way:

   1. In Firebase Console → **Project settings** → **Service accounts** → **Generate new private key** (JSON). Save it as e.g. `serviceAccount.json` in the repo root (that filename is **gitignored**—do not commit it).
   2. Ensure the admin user already exists under **Authentication** (sign up once in the app, or add the user in the console).
   3. From the repo root:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json npm run seed:admin -- --email=you@example.com
   ```

   Or with a known UID:

   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json npm run seed:admin -- --uid=FIREBASE_AUTH_UID
   ```

   The script picks the Firebase project from the **service account JSON’s `project_id`** when you use a key file (so it stays in sync with `.env`). If you only use Application Default Credentials, set `VITE_FIREBASE_PROJECT_ID` or `FIREBASE_PROJECT_ID` in `.env`. You can set `ADMIN_EMAIL` / `ADMIN_UID` in the environment instead of CLI flags.

   Optionally set `VITE_ADMIN_UIDS` in `.env` (comma-separated UIDs) so the UI treats those users as admins during development; **verify/delete in production** still require `admins/{uid}` and deployed rules.

7. Start the app:

   ```bash
   npm run dev
   ```

   The Vite server is configured for LAN access, so you can also open the app from another device on the same network (use the `Network` URL printed by Vite).

8. Open:

   - Landing: `http://localhost:5173/`
   - Map route: `http://localhost:5173/loo-finder-map`

## Firestore Document Shape (`loos/{id}`)

```json
{
  "id": "string",
  "name": "string",
  "latitude": 0,
  "longitude": 0,
  "nearbyLandmarks": "string",
  "rating": 1,
  "price": 0,
  "isFree": true,
  "imageUrls": [],
  "details": "string",
  "ownerUid": "string (Firebase Auth uid of creator)",
  "verified": false,
  "verifiedAt": "timestamp (optional, set by admin)",
  "verifiedByUid": "string (optional, admin uid)",
  "createdAt": "timestamp",
  "updatedAt": "timestamp (optional)",
  "localOnly": false
}
```

## Current Notes

- Image upload is currently skipped in save flow (Firestore-only mode).
- If you get permission errors, confirm Firestore rules were published in the same Firebase project configured in `.env`.
