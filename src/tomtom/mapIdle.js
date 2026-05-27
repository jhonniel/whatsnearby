/** Resolve when the MapLibre map has finished loading its style and tiles. */
export function waitForMapIdle(map) {
  if (map.loaded() && map.isStyleLoaded()) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const done = () => {
      map.off('idle', done)
      resolve()
    }
    map.once('idle', done)
  })
}
