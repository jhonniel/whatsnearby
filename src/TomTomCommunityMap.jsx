import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import {
  TomTomMap,
  RoutingModule,
  TrafficFlowModule,
  TrafficIncidentOverlayModule,
} from '@tomtom-org/maps-sdk/map'
import {
  ensureTomTomConfigured,
  hasTomTomApiKey,
  TOMTOM_API_KEY,
  tomtomStyleForTheme,
} from './tomtom/tomtomEnv'
import { waitForMapIdle } from './tomtom/mapIdle'
import {
  bboxFromMapLibre,
  fetchTrafficIncidentsForBbox,
  incidentFeatureCount,
} from './tomtom/trafficIncidents'
import { createMapBridge } from './tomtom/mapBridge'
import {
  buildCommunityPinElement,
  buildCsvPreviewPinElement,
  buildDraftPinElement,
  buildUserLocationElement,
  pinEmojiForCollection,
} from './tomtom/pinMarkers'

function upsertMarker(markersMap, key, lngLat, buildElement, anchor, onClick) {
  let marker = markersMap.get(key)
  if (!marker) {
    const el = buildElement()
    if (onClick) {
      el.addEventListener('click', (event) => {
        event.stopPropagation()
        onClick()
      })
    }
    marker = new maplibregl.Marker({ element: el, anchor })
    marker.setLngLat(lngLat).addTo(markersMap.__map)
    markersMap.set(key, marker)
  } else {
    marker.setLngLat(lngLat)
  }
  return marker
}

function removeMarker(markersMap, key) {
  const marker = markersMap.get(key)
  if (marker) {
    marker.remove()
    markersMap.delete(key)
  }
}

export function TomTomCommunityMap({
  className = 'map',
  center,
  zoom = 14,
  minZoom = 12,
  maxZoom = 19,
  theme = 'light',
  scrollWheelZoom = true,
  trafficFlowEnabled = true,
  trafficIncidentsEnabled = true,
  onMapReady,
  onRoutingReady,
  onMapClick,
  onCenterChange,
  onPinClick,
  selectedLocation,
  onSelectedScreenPosChange,
  visiblePins = [],
  csvMapPreviewPins = [],
  userLocation,
  activeMapId,
  activePinsCollection,
  pinLabelCategoryKey,
  formMode,
  newPinCategory,
  defaultPinCollection,
}) {
  const containerRef = useRef(null)
  const tomtomMapRef = useRef(null)
  const bridgeRef = useRef(null)
  const markersRef = useRef(new Map())
  const trafficFlowRef = useRef(null)
  const trafficIncidentsOverlayRef = useRef(null)
  const trafficIncidentsFetchIdRef = useRef(0)
  const appliedThemeRef = useRef(theme)
  const refreshTrafficIncidentsRef = useRef(null)
  const trafficFlowEnabledRef = useRef(trafficFlowEnabled)
  const trafficIncidentsEnabledRef = useRef(trafficIncidentsEnabled)
  const onMapReadyRef = useRef(onMapReady)
  const onRoutingReadyRef = useRef(onRoutingReady)
  const onMapClickRef = useRef(onMapClick)
  const onCenterChangeRef = useRef(onCenterChange)
  const onPinClickRef = useRef(onPinClick)
  const onSelectedScreenPosChangeRef = useRef(onSelectedScreenPosChange)

  const refreshTrafficIncidents = async () => {
    const overlay = trafficIncidentsOverlayRef.current
    const ml = tomtomMapRef.current?.mapLibreMap
    if (!overlay || !ml || !trafficIncidentsEnabledRef.current) return

    const fetchId = trafficIncidentsFetchIdRef.current + 1
    trafficIncidentsFetchIdRef.current = fetchId

    try {
      await waitForMapIdle(ml)
      if (fetchId !== trafficIncidentsFetchIdRef.current) return

      const result = await fetchTrafficIncidentsForBbox(bboxFromMapLibre(ml))
      if (fetchId !== trafficIncidentsFetchIdRef.current) return

      const count = incidentFeatureCount(result)
      if (count === 0) {
        await overlay.clear()
      } else {
        await overlay.show(result)
        overlay.moveBeforeLayer?.('top')
      }
      overlay.setVisible(true)

      if (import.meta.env.DEV) {
        console.info(`[TomTom] traffic incidents in view: ${count}`)
      }
    } catch (err) {
      if (fetchId !== trafficIncidentsFetchIdRef.current) return
      console.warn(
        '[TomTom] traffic incidents failed — check Traffic Incident Details on your API key',
        err,
      )
    }
  }

  refreshTrafficIncidentsRef.current = refreshTrafficIncidents

  const applyTrafficVisibility = () => {
    const flowOn = trafficFlowEnabledRef.current
    const incidentsOn = trafficIncidentsEnabledRef.current
    try {
      trafficFlowRef.current?.applyConfig?.({ visible: flowOn }) ??
        trafficFlowRef.current?.setVisible(flowOn)
      trafficIncidentsOverlayRef.current?.setVisible(incidentsOn)
      if (incidentsOn) void refreshTrafficIncidents()
      else void trafficIncidentsOverlayRef.current?.clear()
    } catch (err) {
      console.warn('[TomTom] traffic visibility update failed', err)
    }
  }

  useEffect(() => {
    trafficFlowEnabledRef.current = trafficFlowEnabled
    trafficIncidentsEnabledRef.current = trafficIncidentsEnabled
    applyTrafficVisibility()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh uses refs
  }, [trafficFlowEnabled, trafficIncidentsEnabled])

  useEffect(() => {
    onMapReadyRef.current = onMapReady
    onRoutingReadyRef.current = onRoutingReady
    onMapClickRef.current = onMapClick
    onCenterChangeRef.current = onCenterChange
    onPinClickRef.current = onPinClick
    onSelectedScreenPosChangeRef.current = onSelectedScreenPosChange
  })

  useEffect(() => {
    if (!containerRef.current || !hasTomTomApiKey) return undefined
    ensureTomTomConfigured()

    const [lat, lng] = center
    const tomtomMap = new TomTomMap({
      apiKey: TOMTOM_API_KEY,
      style: tomtomStyleForTheme(theme),
      mapLibre: {
        container: containerRef.current,
        center: [lng, lat],
        zoom,
        minZoom,
        maxZoom,
        scrollZoom: scrollWheelZoom,
        attributionControl: true,
      },
    })

    tomtomMapRef.current = tomtomMap
    const ml = tomtomMap.mapLibreMap
    markersRef.current.__map = ml

    const bridge = createMapBridge(tomtomMap)
    bridgeRef.current = bridge
    onMapReadyRef.current?.(bridge)

    const emitCenter = () => {
      const c = ml.getCenter()
      onCenterChangeRef.current?.([c.lat, c.lng])
    }

    const onClick = (event) => {
      onMapClickRef.current?.({ lat: event.lngLat.lat, lng: event.lngLat.lng })
    }

    const onMoveEnd = () => {
      emitCenter()
      if (selectedLocation) {
        updateSelectedScreenPos(ml, selectedLocation, onSelectedScreenPosChangeRef.current)
      }
    }

    const onMove = () => {
      if (selectedLocation) {
        updateSelectedScreenPos(ml, selectedLocation, onSelectedScreenPosChangeRef.current)
      }
    }

    const onTrafficViewChange = () => {
      if (trafficIncidentsEnabledRef.current) void refreshTrafficIncidentsRef.current?.()
    }

    ml.on('click', onClick)
    ml.on('moveend', onMoveEnd)
    ml.on('move', onMove)
    ml.on('zoom', onMove)
    ml.on('resize', onMove)
    ml.on('moveend', onTrafficViewChange)
    ml.on('zoomend', onTrafficViewChange)

    const ro = new ResizeObserver(() => ml.resize())
    ro.observe(containerRef.current)

    let cancelled = false
    const initModules = async () => {
      const waitReady = () =>
        new Promise((resolve) => {
          if (tomtomMap.mapReady) {
            resolve()
            return
          }
          const check = () => {
            if (tomtomMap.mapReady) resolve()
            else requestAnimationFrame(check)
          }
          check()
        })
      await waitReady()
      if (cancelled) return
      await waitForMapIdle(ml)
      if (cancelled) return

      try {
        const routing = await RoutingModule.get(tomtomMap)
        onRoutingReadyRef.current?.(routing)
      } catch {
        onRoutingReadyRef.current?.(null)
      }
      try {
        const flow = await TrafficFlowModule.get(tomtomMap, {
          visible: true,
          ensureAddedToStyle: true,
        })
        trafficFlowRef.current = flow
      } catch (err) {
        console.warn('[TomTom] traffic flow failed to load — enable Traffic Flow on your API key', err)
        trafficFlowRef.current = null
      }
      try {
        const overlay = await TrafficIncidentOverlayModule.get(tomtomMap, {
          visible: true,
          beforeLayerConfig: 'top',
        })
        trafficIncidentsOverlayRef.current = overlay
      } catch (err) {
        console.warn(
          '[TomTom] traffic incident overlay failed — enable Traffic Incident Details on your API key',
          err,
        )
        trafficIncidentsOverlayRef.current = null
      }
      applyTrafficVisibility()
      emitCenter()
    }
    initModules()

    return () => {
      cancelled = true
      ro.disconnect()
      ml.off('click', onClick)
      ml.off('moveend', onMoveEnd)
      ml.off('moveend', onTrafficViewChange)
      ml.off('zoomend', onTrafficViewChange)
      ml.off('move', onMove)
      ml.off('zoom', onMove)
      ml.off('resize', onMove)
      trafficIncidentsFetchIdRef.current += 1
      for (const marker of markersRef.current.values()) {
        if (marker?.remove) marker.remove()
      }
      markersRef.current.clear()
      onRoutingReadyRef.current?.(null)
      trafficFlowRef.current = null
      trafficIncidentsOverlayRef.current = null
      tomtomMapRef.current = null
      bridgeRef.current = null
      onMapReadyRef.current?.(null)
      ml.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- single map instance per mount
  }, [])

  useEffect(() => {
    const tomtomMap = tomtomMapRef.current
    if (!tomtomMap?.mapReady) return
    if (appliedThemeRef.current === theme) return

    appliedThemeRef.current = theme
    const ml = tomtomMap.mapLibreMap
    const onStyleData = () => {
      if (!ml.isStyleLoaded()) return
      applyTrafficVisibility()
      if (trafficIncidentsEnabledRef.current) void refreshTrafficIncidentsRef.current?.()
    }
    ml.on('styledata', onStyleData)
    tomtomMap.setStyle(tomtomStyleForTheme(theme), true)
    return () => ml.off('styledata', onStyleData)
  }, [theme])

  useEffect(() => {
    bridgeRef.current?.setView(center, zoom, { animate: true })
  }, [center, zoom])

  useEffect(() => {
    const ml = tomtomMapRef.current?.mapLibreMap
    if (!ml) return
    if (scrollWheelZoom) ml.scrollZoom.enable()
    else ml.scrollZoom.disable()
  }, [scrollWheelZoom])

  useEffect(() => {
    const markers = markersRef.current
    const ml = markers.__map
    if (!ml) return

    const pinKeys = new Set()
    for (const pin of visiblePins) {
      const key = `pin:${pin.collection || 'local'}:${pin.id}`
      pinKeys.add(key)
      const category = pinLabelCategoryKey(pin, activeMapId, activePinsCollection)
      upsertMarker(
        markers,
        key,
        [pin.longitude, pin.latitude],
        () => buildCommunityPinElement(pin, { labelCategoryKey: category }),
        'bottom',
        () => onPinClickRef.current?.(pin),
      )
    }
    for (const key of [...markers.keys()]) {
      if (key.startsWith('pin:') && !pinKeys.has(key)) removeMarker(markers, key)
    }

    const csvKeys = new Set()
    for (const p of csvMapPreviewPins) {
      const key = `csv:${p.id}`
      csvKeys.add(key)
      upsertMarker(
        markers,
        key,
        [p.longitude, p.latitude],
        () => buildCsvPreviewPinElement(p),
        'bottom',
      )
    }
    for (const key of [...markers.keys()]) {
      if (key.startsWith('csv:') && !csvKeys.has(key)) removeMarker(markers, key)
    }

    if (userLocation) {
      upsertMarker(markers, 'user', [userLocation[1], userLocation[0]], buildUserLocationElement, 'bottom')
    } else {
      removeMarker(markers, 'user')
    }

    const draftCollection =
      formMode === 'create' && activeMapId === 'community-map' && newPinCategory
        ? newPinCategory
        : defaultPinCollection

    if (selectedLocation) {
      upsertMarker(
        markers,
        'selected',
        [selectedLocation.lng, selectedLocation.lat],
        () =>
          buildDraftPinElement(
            draftCollection,
            pinEmojiForCollection(draftCollection) || '📍',
          ),
        'bottom',
      )
    } else {
      removeMarker(markers, 'selected')
    }
  }, [
    visiblePins,
    csvMapPreviewPins,
    userLocation,
    selectedLocation,
    activeMapId,
    activePinsCollection,
    formMode,
    newPinCategory,
    defaultPinCollection,
    pinLabelCategoryKey,
  ])

  useEffect(() => {
    const ml = tomtomMapRef.current?.mapLibreMap
    if (!ml || !selectedLocation) {
      onSelectedScreenPosChangeRef.current?.(null)
      return
    }
    updateSelectedScreenPos(ml, selectedLocation, onSelectedScreenPosChangeRef.current)
    const raf = requestAnimationFrame(() =>
      updateSelectedScreenPos(ml, selectedLocation, onSelectedScreenPosChangeRef.current),
    )
    return () => cancelAnimationFrame(raf)
  }, [selectedLocation])

  if (!hasTomTomApiKey) {
    return (
      <div className={`${className} tomtom-map-fallback`}>
        <div className="tomtom-map-fallback-card">
          <p className="tomtom-map-fallback-title">TomTom map key required</p>
          <p className="tomtom-map-fallback-text">
            Add <code>VITE_TOMTOM_API_KEY</code> to your <code>.env</code> file (from the{' '}
            <a href="https://developer.tomtom.com/" target="_blank" rel="noreferrer">
              TomTom Developer Portal
            </a>
            ), then restart the dev server.
          </p>
        </div>
      </div>
    )
  }

  return <div className={`${className} tomtom-map-host`} ref={containerRef} role="application" aria-label="Map" />
}

function updateSelectedScreenPos(ml, selectedLocation, onChange) {
  try {
    const point = ml.project([selectedLocation.lng, selectedLocation.lat])
    onChange?.({ x: point.x, y: point.y })
  } catch {
    // Map may not be sized yet.
  }
}
