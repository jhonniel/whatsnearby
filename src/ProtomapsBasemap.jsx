import { useEffect } from 'react'
import { TileLayer, useMap } from 'react-leaflet'
import { leafletLayer } from 'protomaps-leaflet'

const PROTOMAPS_KEY = String(import.meta.env.VITE_PROTOMAPS_API_KEY || '').trim()
const PROTOMAPS_TILES_URL = PROTOMAPS_KEY
  ? `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${PROTOMAPS_KEY}`
  : ''
const PROTOMAPS_ATTRIBUTION =
  '&copy; <a href="https://protomaps.com">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

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
    })
    layer.addTo(map)
    map.attributionControl?.addAttribution(PROTOMAPS_ATTRIBUTION)
    return () => {
      map.removeLayer(layer)
      map.attributionControl?.removeAttribution(PROTOMAPS_ATTRIBUTION)
    }
  }, [map, theme])

  if (!PROTOMAPS_TILES_URL) {
    const baseNoIconsUrl =
      theme === 'dark'
        ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png'
    const labelsOnlyUrl =
      theme === 'dark'
        ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png'
    return (
      <>
        <TileLayer attribution={fallbackAttribution} url={baseNoIconsUrl} />
        <TileLayer url={labelsOnlyUrl} pane="overlayPane" />
      </>
    )
  }
  return null
}
