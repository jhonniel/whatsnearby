import { useEffect } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import { leafletLayer } from 'protomaps-leaflet'

const PROTOMAPS_KEY = String(import.meta.env.VITE_PROTOMAPS_API_KEY || '').trim()
const PROTOMAPS_TILES_URL = PROTOMAPS_KEY
  ? `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${PROTOMAPS_KEY}`
  : ''
const PROTOMAPS_ATTRIBUTION =
  '&copy; <a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

/** Match main map max zoom; Carto tiles native ~19, allow Leaflet to overzoom slightly. */
const RASTER_MAX_ZOOM = 22
const RASTER_MAX_NATIVE_ZOOM = 19

export function ProtomapsBasemap({
  theme = 'light',
  fallbackAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
}) {
  const map = useMap()
  useEffect(() => {
    if (!PROTOMAPS_TILES_URL) return undefined
    const layer = leafletLayer({
      url: PROTOMAPS_TILES_URL,
      flavor: theme === 'dark' ? 'dark' : 'light',
      lang: 'en',
      maxZoom: RASTER_MAX_ZOOM,
      maxNativeZoom: 15,
    })
    layer.addTo(map)
    map.attributionControl?.addAttribution(PROTOMAPS_ATTRIBUTION)
    return () => {
      map.removeLayer(layer)
      map.attributionControl?.removeAttribution(PROTOMAPS_ATTRIBUTION)
    }
  }, [map, theme])

  const fallbackBaseUrl =
    theme === 'dark'
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'

  // Always render raster fallback under Protomaps so map never becomes blank.
  return (
    <>
      <TileLayer
        attribution={fallbackAttribution}
        url={fallbackBaseUrl}
        maxZoom={RASTER_MAX_ZOOM}
        maxNativeZoom={RASTER_MAX_NATIVE_ZOOM}
      />
    </>
  )
}
