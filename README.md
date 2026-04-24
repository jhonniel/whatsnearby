# Loo Locator

Loo Locator is a React + Firebase web app for discovering, pinning, and navigating to public toilet locations on an interactive map.

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
  - current user location marker
  - click map / pin-at-center flow for adding locations
  - anchored smart popup form (auto-positioned to stay visible)
  - mobile-responsive bottom-sheet form behavior
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
  - "Get Directions" from user location to selected loo
  - route polyline rendering + distance/time summary
- Authentication:
  - login/signup modal (Firebase Auth)
  - logout support
  - pin updates require authenticated user
- Firestore sync:
  - realtime snapshot updates from `loos` collection
  - optimistic local pin display while sync happens

## Tech Stack

- React (functional components + hooks)
- Firebase Firestore
- Firebase Authentication
- Leaflet + React Leaflet + OpenStreetMap tiles
- Nominatim reverse geocoding
- OSRM directions API

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Fill `.env` with your Firebase Web app config values.

4. In Firebase Console:
   - Enable **Firestore Database**
   - Enable **Authentication** (Email/Password provider)
   - (Optional) Enable Storage only if you plan to add image uploads back later

5. Use development Firestore rules while testing:

   ```txt
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true;
       }
     }
   }
   ```

6. Start the app:

   ```bash
   npm run dev
   ```

7. Open:

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
  "createdAt": "timestamp",
  "updatedAt": "timestamp (optional)",
  "localOnly": false
}
```

## Current Notes

- Image upload is currently skipped in save flow (Firestore-only mode).
- If you get permission errors, confirm Firestore rules were published in the same Firebase project configured in `.env`.
