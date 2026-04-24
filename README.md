# Loo Locator

Loo Locator is a full-stack React + Firebase app for pinning and discovering public toilet locations on an interactive OpenStreetMap map.

## Features

- Interactive map centered on user location (with geolocation fallback)
- Click map to add a new loo pin
- Reverse geocoding for nearby landmarks (Nominatim)
- Firestore persistence for loo metadata
- Firebase Storage uploads for multiple images per loo
- Marker popups with stars, details, and image gallery
- Rating filter, locate-me action, and marker clustering

## Tech Stack

- React (functional components + hooks)
- Firebase Firestore + Firebase Storage
- Leaflet + React Leaflet + OpenStreetMap tiles

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

4. Create a Firestore collection named `loos`.

5. Start the app:

   ```bash
   npm run dev
   ```

## Firestore Document Shape (`loos/{id}`)

```json
{
  "id": "string",
  "name": "string",
  "latitude": 0,
  "longitude": 0,
  "nearbyLandmarks": "string",
  "rating": 1,
  "imageUrls": ["https://..."],
  "details": "string",
  "createdAt": "timestamp"
}
```
