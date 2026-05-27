import { calculateRoute } from '@tomtom-org/maps-sdk/services'
import { ensureTomTomConfigured, hasTomTomApiKey } from './tomtomEnv'

/** Average driving speed (km/h) from route length and travel time (includes traffic delays). */
export function averageSpeedKmhFromRoute(distanceMeters, durationSeconds) {
  const meters = Number(distanceMeters)
  const seconds = Number(durationSeconds)
  if (!Number.isFinite(meters) || !Number.isFinite(seconds) || seconds <= 0 || meters <= 0) {
    return null
  }
  return Math.round((meters / 1000) / (seconds / 3600))
}

/**
 * Plan a driving route with TomTom Routing (Maps SDK services).
 * @returns {{ routes: import('@tomtom-org/maps-sdk/core').Routes, distanceMeters: number, durationSeconds: number, averageSpeedKmh: number | null }}
 */
export async function fetchTomTomRoute(startLat, startLng, destLat, destLng) {
  if (!hasTomTomApiKey) {
    throw new Error('Add VITE_TOMTOM_API_KEY to use TomTom directions.')
  }
  ensureTomTomConfigured()

  const routes = await calculateRoute({
    locations: [
      [startLng, startLat],
      [destLng, destLat],
    ],
    travelMode: 'car',
    costModel: {
      routeType: 'fast',
      traffic: 'live',
    },
  })

  const summary = routes.features?.[0]?.properties?.summary
  if (!summary) {
    throw new Error('No route found to this destination.')
  }

  const distanceMeters = summary.lengthInMeters ?? 0
  const durationSeconds = summary.travelTimeInSeconds ?? 0

  return {
    routes,
    distanceMeters,
    durationSeconds,
    averageSpeedKmh: averageSpeedKmhFromRoute(distanceMeters, durationSeconds),
  }
}
