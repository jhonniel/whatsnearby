import { TomTomConfig } from '@tomtom-org/maps-sdk/core'

export const TOMTOM_API_KEY = String(import.meta.env.VITE_TOMTOM_API_KEY || '').trim()

export const hasTomTomApiKey = Boolean(TOMTOM_API_KEY)

export const TOMTOM_ATTRIBUTION =
  '&copy; <a href="https://www.tomtom.com/copyright/" target="_blank" rel="noreferrer">TomTom</a>'

let configured = false

/** Configure global TomTom SDK once (safe to call repeatedly). */
export function ensureTomTomConfigured() {
  if (!hasTomTomApiKey) return false
  if (!configured) {
    TomTomConfig.instance.put({ apiKey: TOMTOM_API_KEY })
    configured = true
  }
  return true
}

/** TomTom standard style with real-time traffic layers enabled in the map style. */
export function tomtomStyleForTheme(theme) {
  const id = theme === 'dark' ? 'standardDark' : 'standardLight'
  return {
    type: 'standard',
    id,
    // Flow uses vector tiles; incidents are loaded via Incident Details + overlay module.
    include: ['trafficFlow'],
  }
}
