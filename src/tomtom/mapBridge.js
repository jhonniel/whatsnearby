/**
 * Leaflet-shaped adapter around TomTomMap / MapLibre for existing app logic.
 */
export function createMapBridge(tomtomMap) {
  const ml = () => tomtomMap.mapLibreMap

  return {
    tomtomMap,
    mapLibreMap: tomtomMap.mapLibreMap,

    setView([lat, lng], zoom, { animate = true } = {}) {
      const map = ml()
      if (animate) {
        map.flyTo({ center: [lng, lat], zoom, essential: true })
      } else {
        map.jumpTo({ center: [lng, lat], zoom })
      }
    },

    getZoom() {
      return ml().getZoom()
    },

    closePopup() {
      // No Leaflet popups on TomTom map.
    },

    latLngToContainerPoint({ lat, lng }) {
      const p = ml().project([lng, lat])
      return { x: p.x, y: p.y }
    },

    panInside([lat, lng], { paddingTopLeft = [0, 0], paddingBottomRight = [0, 0], animate = true, duration = 250 } = {}) {
      const map = ml()
      const point = map.project([lng, lat])
      const { clientWidth: w, clientHeight: h } = map.getContainer()
      const [padLeft, padTop] = paddingTopLeft
      const [padRight, padBottom] = paddingBottomRight
      let dx = 0
      let dy = 0
      if (point.x < padLeft) dx = padLeft - point.x
      if (point.x > w - padRight) dx = w - padRight - point.x
      if (point.y < padTop) dy = padTop - point.y
      if (point.y > h - padBottom) dy = h - padBottom - point.y
      if (dx === 0 && dy === 0) return
      const centerPoint = map.project(map.getCenter())
      const next = map.unproject([centerPoint.x - dx, centerPoint.y - dy])
      if (animate) {
        map.easeTo({ center: next, duration: duration * 1000, essential: true })
      } else {
        map.jumpTo({ center: next })
      }
    },

    fitBoundsFromPins(pins, { padding = 48, maxZoom = 16, animate = true } = {}) {
      if (!pins?.length) return
      const map = ml()
      let minLng = Infinity
      let minLat = Infinity
      let maxLng = -Infinity
      let maxLat = -Infinity
      for (const pin of pins) {
        const lat = Number(pin.latitude)
        const lng = Number(pin.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
        minLng = Math.min(minLng, lng)
        minLat = Math.min(minLat, lat)
        maxLng = Math.max(maxLng, lng)
        maxLat = Math.max(maxLat, lat)
      }
      if (!Number.isFinite(minLng)) return
      const bounds = [
        [minLng, minLat],
        [maxLng, maxLat],
      ]
      if (animate) {
        map.fitBounds(bounds, { padding, maxZoom, essential: true })
      } else {
        map.fitBounds(bounds, { padding, maxZoom, animate: false })
      }
    },
  }
}
