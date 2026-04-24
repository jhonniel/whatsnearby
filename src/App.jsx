import { useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import './App.css'
import { auth, db, hasFirebaseConfig } from './firebase'

const DEFAULT_CENTER = [7.0731, 125.6128]

const toiletIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Toilet">🚽</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const userIcon = L.icon({
  iconUrl: '/user-location-pin.png',
  iconSize: [46, 62],
  iconAnchor: [23, 62],
  popupAnchor: [0, -56],
})

const mapCatalog = [
  {
    id: 'loo-finder',
    title: 'Loo Finder Map',
    category: 'Sanitation',
    description: 'Find and pin nearby public restrooms with ratings, directions, and details.',
    status: 'available',
  },
  {
    id: 'water-refill',
    title: 'Water Refill Map',
    category: 'Utilities',
    description: 'Community map for potable water refill stations.',
    status: 'coming-soon',
  },
  {
    id: 'accessibility',
    title: 'Accessibility Map',
    category: 'Mobility',
    description: 'Map for ramps, elevators, and accessibility-friendly routes.',
    status: 'coming-soon',
  },
]

const landingStats = [
  { label: 'Mapped Locations', value: '1,250+' },
  { label: 'Community Contributors', value: '320+' },
  { label: 'Monthly Directions', value: '9,800+' },
  { label: 'Cities Covered', value: '18' },
]

const processSteps = [
  {
    title: 'Select a map',
    text: 'Choose a map category and preview your nearby area before opening it.',
  },
  {
    title: 'Pin useful locations',
    text: 'Add verified location details including landmarks, pricing, and rating.',
  },
  {
    title: 'Navigate quickly',
    text: 'Use built-in best-route guidance to reach the selected location fast.',
  },
]

function mapIdToPath(mapId) {
  if (mapId === 'loo-finder') return '/loo-finder-map'
  if (mapId === 'water-refill') return '/water-refill-map'
  if (mapId === 'accessibility') return '/accessibility-map'
  return '/'
}

function pathToMapId(pathname) {
  if (pathname === '/loo-finder-map') return 'loo-finder'
  if (pathname === '/water-refill-map') return 'water-refill'
  if (pathname === '/accessibility-map') return 'accessibility'
  return null
}

function LandingMapPreview({ location, theme }) {
  if (!location) {
    return (
      <div className="map-preview-fallback">
        Enable location to preview nearby map area
      </div>
    )
  }

  return (
    <MapContainer
      center={location}
      zoom={13}
      className="map-preview-live"
      zoomControl={false}
      dragging={false}
      doubleClickZoom={false}
      scrollWheelZoom={false}
      touchZoom={false}
      boxZoom={false}
      keyboard={false}
      attributionControl={false}
    >
      <TileLayer
        url={
          theme === 'dark'
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
        }
      />
      <CircleMarker
        center={location}
        radius={7}
        pathOptions={{
          color: '#ffffff',
          weight: 2,
          fillColor: '#ef4444',
          fillOpacity: 1,
        }}
      />
    </MapContainer>
  )
}

function Stars({ value }) {
  return (
    <div className="stars" aria-label={`Rating: ${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} className={star <= value ? 'star-filled' : 'star-empty'}>
          ★
        </span>
      ))}
    </div>
  )
}

function LocateMap({ center }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, 15)
  }, [center, map])
  return null
}

function MapEvents({ onMapClick, onCenterChange }) {
  const map = useMapEvents({
    click(event) {
      onMapClick(event.latlng)
    },
    moveend() {
      const current = map.getCenter()
      onCenterChange([current.lat, current.lng])
    },
  })

  useEffect(() => {
    const current = map.getCenter()
    onCenterChange([current.lat, current.lng])
  }, [map, onCenterChange])

  return null
}

function SelectedPinOverlayTracker({ selectedLocation, onPositionChange }) {
  const map = useMapEvents({
    move() {
      if (!selectedLocation) return
      const point = map.latLngToContainerPoint(selectedLocation)
      onPositionChange({ x: point.x, y: point.y })
    },
    zoom() {
      if (!selectedLocation) return
      const point = map.latLngToContainerPoint(selectedLocation)
      onPositionChange({ x: point.x, y: point.y })
    },
  })

  useEffect(() => {
    if (!selectedLocation) {
      onPositionChange(null)
      return
    }
    const point = map.latLngToContainerPoint(selectedLocation)
    onPositionChange({ x: point.x, y: point.y })
  }, [map, onPositionChange, selectedLocation])

  return null
}

function distanceInMeters(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180
  const earthRadius = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return earthRadius * c
}

function App() {
  const mapShellRef = useRef(null)
  const [remotePins, setRemotePins] = useState([])
  const [localPins, setLocalPins] = useState([])
  const [mapCenter, setMapCenter] = useState(DEFAULT_CENTER)
  const [visibleCenter, setVisibleCenter] = useState(DEFAULT_CENTER)
  const [userLocation, setUserLocation] = useState(null)
  const [loadingPins, setLoadingPins] = useState(hasFirebaseConfig)
  const [isLocating, setIsLocating] = useState(false)
  const [reverseLookupLoading, setReverseLookupLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [formError, setFormError] = useState('')
  const [filterRating, setFilterRating] = useState('all')
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [selectedScreenPos, setSelectedScreenPos] = useState(null)
  const [anchoredModalStyle, setAnchoredModalStyle] = useState({})
  const [showBelowPin, setShowBelowPin] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('loo-theme') || 'light')
  const [routeCoords, setRouteCoords] = useState([])
  const [routeSummary, setRouteSummary] = useState(null)
  const [routingForPinId, setRoutingForPinId] = useState(null)
  const [activeMapId, setActiveMapId] = useState(() => pathToMapId(window.location.pathname))
  const [currentUser, setCurrentUser] = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [pendingEditPin, setPendingEditPin] = useState(null)
  const [formMode, setFormMode] = useState('create')
  const [editingPinId, setEditingPinId] = useState(null)
  const [form, setForm] = useState({
    name: '',
    nearbyLandmarks: '',
    rating: '',
    price: '',
    isFree: false,
    details: '',
    images: [],
  })

  useEffect(() => {
    const onPopState = () => {
      const nextMapId = pathToMapId(window.location.pathname)
      setActiveMapId(nextMapId)
    }

    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const nextPath = activeMapId ? mapIdToPath(activeMapId) : '/'
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
  }, [activeMapId])

  useEffect(() => {
    if (!hasFirebaseConfig || !auth) return undefined
    const unsubscribe = onAuthStateChanged(auth, (user) => setCurrentUser(user))
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!hasFirebaseConfig) {
      return undefined
    }

    const q = query(collection(db, 'loos'), orderBy('createdAt', 'desc'))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const nextRemotePins = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }))
        const remoteIds = new Set(nextRemotePins.map((pin) => pin.id))
        setRemotePins(nextRemotePins)
        setLocalPins((current) => current.filter((pin) => !remoteIds.has(pin.id)))
        setLoadingPins(false)
      },
      () => {
        setError('Unable to read Firebase data. Local pin mode is still available.')
        setLoadingPins(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = [position.coords.latitude, position.coords.longitude]
        setMapCenter(current)
        setUserLocation(current)
      },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }, [])

  const pins = useMemo(() => [...localPins, ...remotePins], [localPins, remotePins])
  const visiblePins = useMemo(() => {
    if (filterRating === 'all') return pins
    return pins.filter((pin) => pin.rating >= Number(filterRating))
  }, [pins, filterRating])

  const locateMe = () => {
    if (!navigator.geolocation) return
    setIsLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = [position.coords.latitude, position.coords.longitude]
        setMapCenter(current)
        setUserLocation(current)
        setIsLocating(false)
      },
      () => {
        setIsLocating(false)
        setError('Unable to fetch your location.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const reverseGeocode = async (lat, lng) => {
    setReverseLookupLoading(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=jsonv2`,
      )
      const data = await response.json()
      const descriptor =
        `${data?.display_name || ''} ${data?.name || ''} ${data?.category || ''} ${data?.type || ''}`.toLowerCase()
      const waterKeywords = [
        'sea',
        'ocean',
        'lake',
        'river',
        'bay',
        'lagoon',
        'reservoir',
        'water',
        'coast',
        'coastline',
        'island',
        'islet',
        'archipelago',
        'isla',
      ]
      const blockedCategoryType =
        (data?.category === 'natural' &&
          ['water', 'coastline', 'bay'].includes(String(data?.type || '').toLowerCase())) ||
        (data?.category === 'place' &&
          ['island', 'islet', 'archipelago'].includes(String(data?.type || '').toLowerCase()))
      const hasGoodAddressSignal = Boolean(
        data?.address?.road ||
          data?.address?.pedestrian ||
          data?.address?.neighbourhood ||
          data?.address?.suburb,
      )
      const matchedLat = Number(data?.lat)
      const matchedLng = Number(data?.lon)
      const snappedDistance =
        Number.isFinite(matchedLat) && Number.isFinite(matchedLng)
          ? distanceInMeters(lat, lng, matchedLat, matchedLng)
          : Number.POSITIVE_INFINITY
      const likelySnappedFromWater = snappedDistance > 140 && !hasGoodAddressSignal
      const isWaterArea =
        waterKeywords.some((word) => descriptor.includes(word)) ||
        blockedCategoryType ||
        likelySnappedFromWater

      if (isWaterArea) {
        return { blocked: true }
      }

      const autoName =
        data?.name ||
        data?.address?.road ||
        data?.address?.pedestrian ||
        data?.address?.neighbourhood ||
        data?.address?.suburb ||
        ''
      setForm((current) => ({
        ...current,
        name: current.name || autoName,
        nearbyLandmarks: current.nearbyLandmarks || data?.display_name || '',
      }))
      return { blocked: false }
    } catch {
      setError('Could not fetch nearby landmark automatically.')
      return { blocked: false }
    } finally {
      setReverseLookupLoading(false)
    }
  }

  const openPinForm = async (latlng) => {
    setError('')
    setNotice('')
    setFormError('')
    setSaving(false)
    setFormMode('create')
    setEditingPinId(null)
    setForm({
      name: '',
      nearbyLandmarks: '',
      rating: '',
      price: '',
      isFree: false,
      details: '',
      images: [],
    })
    const reverseResult = await reverseGeocode(latlng.lat, latlng.lng)
    if (reverseResult?.blocked) {
      setSelectedLocation(null)
      setError('Location cannot be pinned (sea/lake/river).')
      return
    }
    setSelectedLocation(latlng)
  }

  useEffect(() => {
    localStorage.setItem('loo-theme', theme)
  }, [theme])

  const openEditPinForm = (pin) => {
    if (!currentUser) {
      setPendingEditPin(pin)
      setShowAuthModal(true)
      setAuthMode('login')
      setAuthError('')
      return
    }

    setFormMode('edit')
    setEditingPinId(pin.id)
    setSelectedLocation({ lat: pin.latitude, lng: pin.longitude })
    setForm({
      name: pin.name || '',
      nearbyLandmarks: pin.nearbyLandmarks || '',
      rating: pin.rating ? String(pin.rating) : '',
      price: pin.price != null ? String(pin.price) : '',
      isFree: Boolean(pin.isFree),
      details: pin.details || '',
      images: [],
    })
    setFormError('')
    setError('')
    setNotice('')
  }

  const submitAuth = async (event) => {
    event.preventDefault()
    if (!auth) return
    if (!authForm.email || !authForm.password) {
      setAuthError('Email and password are required.')
      return
    }

    setAuthLoading(true)
    setAuthError('')
    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, authForm.email, authForm.password)
      } else {
        await signInWithEmailAndPassword(auth, authForm.email, authForm.password)
      }
      setShowAuthModal(false)
      setNotice('Authentication successful.')
      if (pendingEditPin) {
        const targetPin = pendingEditPin
        setPendingEditPin(null)
        openEditPinForm(targetPin)
      }
    } catch (authSubmitError) {
      setAuthError(authSubmitError?.message || 'Authentication failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = async () => {
    if (!auth) return
    await signOut(auth)
    setNotice('Logged out.')
  }

  const withTimeout = (promise, timeoutMs, message) =>
    Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])

  const getBestRouteToPin = async (pin) => {
    if (!userLocation) {
      setError('Enable location first to get directions.')
      return
    }

    setError('')
    setNotice('')
    setRoutingForPinId(pin.id)

    try {
      const [startLat, startLng] = userLocation
      const response = await withTimeout(
        fetch(
          `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${pin.longitude},${pin.latitude}?overview=full&geometries=geojson&alternatives=true`,
        ),
        12000,
        'Directions request timed out.',
      )

      if (!response.ok) {
        throw new Error('Could not fetch directions right now.')
      }

      const data = await response.json()
      const routes = Array.isArray(data?.routes) ? data.routes : []
      if (!routes.length) {
        throw new Error('No route found to this loo.')
      }

      // OSRM returns fastest route first; re-check by duration.
      const bestRoute = routes.reduce((best, current) =>
        current.duration < best.duration ? current : best,
      )

      const coords = bestRoute.geometry?.coordinates?.map(([lng, lat]) => [lat, lng]) ?? []
      setRouteCoords(coords)
      setRouteSummary({
        distanceKm: (bestRoute.distance / 1000).toFixed(2),
        durationMin: Math.max(1, Math.round(bestRoute.duration / 60)),
        destinationName: pin.name,
      })
      setNotice(`Best route ready: ${bestRoute.distance ? `${(bestRoute.distance / 1000).toFixed(2)} km` : ''}`)
    } catch (routeError) {
      setError(routeError.message || 'Failed to get directions.')
    } finally {
      setRoutingForPinId(null)
    }
  }

  const savePin = async (event) => {
    event.preventDefault()
    if (!selectedLocation) return
    if (!form.name.trim()) {
      setFormError('Location name is required.')
      return
    }
    const numericRating = Number(form.rating)
    if (!form.rating || Number.isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      setFormError('Please set a rating between 1 and 5.')
      return
    }
    const numericPrice = Number(form.price)
    if (!form.isFree && (!form.price || Number.isNaN(numericPrice) || numericPrice < 0)) {
      setFormError('Please provide a valid price or mark it as free.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')
    setFormError('')

    const tempId = `local-${Date.now()}`
    const optimisticPin = {
      id: tempId,
      name: form.name.trim(),
      latitude: selectedLocation.lat,
      longitude: selectedLocation.lng,
      nearbyLandmarks: form.nearbyLandmarks.trim(),
      rating: numericRating,
      price: form.isFree ? 0 : numericPrice,
      isFree: form.isFree,
      imageUrls: [],
      details: form.details.trim(),
      localOnly: true,
    }
    if (formMode === 'edit') {
      if (!currentUser) {
        setFormError('Login required to update pins.')
        setShowAuthModal(true)
        return
      }

      const targetId = editingPinId
      if (!targetId) {
        setFormError('No pin selected for update.')
        return
      }

      setLocalPins((current) =>
        current.map((pin) => (pin.id === targetId ? { ...pin, ...optimisticPin, id: targetId } : pin)),
      )

      try {
        await withTimeout(
          updateDoc(doc(db, 'loos', targetId), {
            name: optimisticPin.name,
            nearbyLandmarks: optimisticPin.nearbyLandmarks,
            rating: optimisticPin.rating,
            price: optimisticPin.price,
            isFree: optimisticPin.isFree,
            details: optimisticPin.details,
            updatedAt: serverTimestamp(),
          }),
          10000,
          'Update timed out. Check internet or Firestore rules.',
        )
        setRemotePins((current) =>
          current.map((pin) =>
            pin.id === targetId
              ? {
                  ...pin,
                  name: optimisticPin.name,
                  nearbyLandmarks: optimisticPin.nearbyLandmarks,
                  rating: optimisticPin.rating,
                  price: optimisticPin.price,
                  isFree: optimisticPin.isFree,
                  details: optimisticPin.details,
                }
              : pin,
          ),
        )
        setNotice('Pin updated successfully.')
        setSelectedLocation(null)
        setFormMode('create')
        setEditingPinId(null)
      } catch (saveError) {
        setError(saveError?.message || 'Failed to update pin.')
      } finally {
        setSaving(false)
      }
      return
    }

    setLocalPins((current) => [optimisticPin, ...current])
    setFilterRating('all')
    setSelectedLocation(null)

    if (!hasFirebaseConfig) {
      setNotice('Pin saved locally only. Add Firebase credentials to sync online.')
      setSaving(false)
      return
    }

    let syncedPinId = null
    try {
      const pinRef = doc(collection(db, 'loos'))
      const syncedOptimisticPin = {
        ...optimisticPin,
        id: pinRef.id,
        localOnly: false,
      }
      syncedPinId = pinRef.id
      setLocalPins((current) => [
        syncedOptimisticPin,
        ...current.filter((pin) => pin.id !== tempId),
      ])

      await withTimeout(
        setDoc(pinRef, {
          ...syncedOptimisticPin,
          id: pinRef.id,
          createdAt: serverTimestamp(),
        }),
        10000,
        'Firebase save timed out. Check internet or Firestore rules.',
      )

      setNotice(
        form.images.length
          ? 'Pin saved to Firebase (images are skipped; Storage disabled).'
          : 'Pin syncing to Firebase...',
      )
    } catch (saveError) {
      setLocalPins((current) =>
        current.map((pin) =>
          pin.id === syncedPinId
            ? { ...pin, localOnly: true }
            : pin,
        ),
      )
      setError(saveError?.message || 'Firebase save failed.')
      setNotice('Pin saved locally only (Firebase write blocked).')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!selectedLocation || !selectedScreenPos || !mapShellRef.current) return

    const shellRect = mapShellRef.current.getBoundingClientRect()
    const margin = 12
    const preferredWidth = 500
    const estimatedModalHeight = 560
    const anchorOffset = 24
    const modalWidth = Math.max(280, Math.min(preferredWidth, shellRect.width - margin * 2))
    const leftMin = modalWidth / 2 + margin
    const leftMax = shellRect.width - modalWidth / 2 - margin
    const left = Math.min(Math.max(selectedScreenPos.x, leftMin), leftMax)

    // Auto-place popup to avoid the navbar and map bounds.
    const availableAbove = selectedScreenPos.y - margin
    const availableBelow = shellRect.height - selectedScreenPos.y - margin
    const placeBelow = availableAbove < estimatedModalHeight && availableBelow > availableAbove
    const top = placeBelow
      ? Math.min(selectedScreenPos.y + anchorOffset, shellRect.height - margin)
      : Math.max(selectedScreenPos.y - anchorOffset, margin)
    const maxHeight = Math.max(220, (placeBelow ? availableBelow : availableAbove) - 14)

    setShowBelowPin(placeBelow)
    setAnchoredModalStyle({
      left: `${left}px`,
      top: `${top}px`,
      width: `${modalWidth}px`,
      maxHeight: `${maxHeight}px`,
      transform: placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
    })
  }, [selectedLocation, selectedScreenPos])

  if (!activeMapId) {
    return (
      <main className={`app-shell ${theme === 'dark' ? 'dark' : ''}`}>
        <section className="landing-shell">
          <header className="landing-hero scenic-hero">
            <div className="hero-pill-row">
              <span className="hero-pill">Community-first</span>
              <span className="hero-pill">Realtime mapping</span>
            </div>
            <h1>Loo Locator</h1>
            <p>
              Choose a map category to start exploring community-based location intelligence.
            </p>
            <p className="landing-subtext">
              Built for everyday convenience, Loo Locator helps people quickly find clean restroom
              spots, compare details, and navigate with confidence.
            </p>
            <label className="theme-toggle" aria-label="Toggle dark mode">
              <input
                type="checkbox"
                checked={theme === 'dark'}
                onChange={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              />
              <span className="toggle-track">
                <span className="toggle-thumb"></span>
              </span>
              <span className="toggle-text">Dark mode</span>
            </label>
          </header>

          <section className="map-grid scenic-section maps-top">
            {mapCatalog.map((item) => (
              <article
                key={item.id}
                className={`map-card ${item.status !== 'available' ? 'disabled' : ''}`}
              >
                {item.id === 'loo-finder' ? (
                  <div className="map-preview">
                    <LandingMapPreview location={userLocation} theme={theme} />
                  </div>
                ) : null}
                <span className="map-chip">{item.category}</span>
                <h2>{item.title}</h2>
                <p>{item.description}</p>
                {item.status === 'available' ? (
                  <button type="button" onClick={() => setActiveMapId(item.id)}>
                    Open Map
                  </button>
                ) : (
                  <button type="button" className="secondary" disabled>
                    Coming Soon
                  </button>
                )}
              </article>
            ))}
          </section>

          <section className="feature-grid scenic-section">
            <article className="feature-card">
              <h3>Reliable Location Pins</h3>
              <p>
                Add and browse verified loo points with landmarks, ratings, and helpful context for
                faster decisions.
              </p>
            </article>
            <article className="feature-card">
              <h3>Smart Routing</h3>
              <p>
                Get best-route guidance from your current location to any selected loo pin in just
                one tap.
              </p>
            </article>
            <article className="feature-card">
              <h3>Community Friendly</h3>
              <p>
                Designed for public use with mobile-ready UI, dark mode, and simple contribution
                workflows.
              </p>
            </article>
          </section>

          <section className="stats-grid">
            {landingStats.map((item) => (
              <article key={item.label} className="stat-card">
                <strong>{item.value}</strong>
                <span>{item.label}</span>
              </article>
            ))}
          </section>

          <section className="showcase-strip">
            <article className="showcase-card large">
              <h3>Explore Nearby Coverage</h3>
              <p>Preview available map coverage around your current position before opening.</p>
            </article>
            <article className="showcase-card">
              <h3>Mobile-first</h3>
              <p>Designed for quick use on the go with smooth touch-friendly controls.</p>
            </article>
            <article className="showcase-card">
              <h3>Clean UI</h3>
              <p>Readable visuals and structured cards for faster map selection.</p>
            </article>
          </section>

          <section className="journey-section scenic-section">
            <div className="journey-header">
              <h2>How It Works</h2>
              <p>
                A simple workflow designed for fast access to trusted map-based community information.
              </p>
            </div>
            <div className="journey-grid">
              {processSteps.map((step, index) => (
                <article key={step.title} className="journey-card">
                  <span className="journey-index">0{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="trust-section">
            <article className="trust-card">
              <h3>Designed for real-world use</h3>
              <p>
                Loo Locator balances clean visuals, practical details, and quick routing so users can
                confidently decide where to go next.
              </p>
            </article>
            <article className="trust-card">
              <h3>Built with scalable architecture</h3>
              <p>
                Powered by Firebase and OpenStreetMap services, the platform is ready for growing
                categories and location datasets.
              </p>
            </article>
          </section>

          <footer className="landing-footer scenic-footer">
            <div>
              <strong>Loo Locator</strong>
              <p>Helping communities discover clean and accessible public restrooms.</p>
            </div>
            <div className="footer-meta">
              <span>Realtime map updates</span>
              <span>Mobile responsive</span>
              <span>Powered by OpenStreetMap + Firebase</span>
            </div>
          </footer>
        </section>
      </main>
    )
  }

  return (
    <main className={`app-shell ${theme === 'dark' ? 'dark' : ''}`}>
      <header className="top-bar">
        <div className="brand-block">
          <h1>Loo Locator</h1>
          <p>Click map to pin, then fill the popup form.</p>
        </div>
        <div className="top-bar-actions">
          <button type="button" className="secondary" onClick={() => setActiveMapId(null)}>
            Back to Maps
          </button>
          <div className="controls-row controls-row-top">
            <select
              className="control-input"
              value={filterRating}
              onChange={(event) => setFilterRating(event.target.value)}
            >
              <option value="all">All ratings</option>
              <option value="5">5 stars only</option>
              <option value="4">4 stars and up</option>
              <option value="3">3 stars and up</option>
              <option value="2">2 stars and up</option>
              <option value="1">1 star and up</option>
            </select>
          </div>
          <div className="controls-row controls-row-bottom">
            <button type="button" className="secondary" onClick={locateMe} disabled={isLocating}>
              {isLocating ? 'Locating...' : 'Locate Me'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => openPinForm({ lat: visibleCenter[0], lng: visibleCenter[1] })}
            >
              Pin At Center
            </button>
            <label className="theme-toggle" aria-label="Toggle dark mode">
              <input
                type="checkbox"
                checked={theme === 'dark'}
                onChange={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              />
              <span className="toggle-track">
                <span className="toggle-thumb"></span>
              </span>
              <span className="toggle-text">Dark mode</span>
            </label>
            {currentUser ? (
              <button type="button" className="secondary" onClick={handleLogout}>
                Logout
              </button>
            ) : (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setShowAuthModal(true)
                  setAuthMode('login')
                  setAuthError('')
                }}
              >
                Login
              </button>
            )}
          </div>
        </div>
      </header>

      {error ? <p className="status error">{error}</p> : null}
      {notice ? <p className="status warning">{notice}</p> : null}
      {loadingPins ? <p className="status">Loading pins...</p> : null}

      <section className="map-shell" ref={mapShellRef}>
        <MapContainer center={mapCenter} zoom={14} className="map" tap={false}>
          <LocateMap center={mapCenter} />
          <MapEvents onMapClick={openPinForm} onCenterChange={setVisibleCenter} />
          <SelectedPinOverlayTracker
            selectedLocation={selectedLocation}
            onPositionChange={setSelectedScreenPos}
          />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={
              theme === 'dark'
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
            }
          />

          {visiblePins.map((pin) => (
            <Marker key={pin.id} position={[pin.latitude, pin.longitude]} icon={toiletIcon}>
              <Popup maxWidth={280}>
                <article className="popup-content">
                  <h3>{pin.name}</h3>
                  <p>{pin.nearbyLandmarks || 'No nearby landmark'}</p>
                  <Stars value={pin.rating} />
                  {Array.isArray(pin.imageUrls) && pin.imageUrls.length > 0 ? (
                    <div className="gallery">
                      {pin.imageUrls.map((url) => (
                        <img key={url} src={url} alt={pin.name} loading="lazy" />
                      ))}
                    </div>
                  ) : null}
                  <p>{pin.details || 'No additional details.'}</p>
                  <p className="price-info">
                    {pin.isFree ? 'Free' : `Price: ₱${Number(pin.price || 0).toFixed(2)}`}
                  </p>
                  {pin.localOnly ? <small className="hint">Local only</small> : null}
                  <button
                    type="button"
                    className="route-btn"
                    onClick={() => getBestRouteToPin(pin)}
                    disabled={routingForPinId === pin.id}
                  >
                    {routingForPinId === pin.id ? 'Routing...' : 'Get Directions'}
                  </button>
                  <button
                    type="button"
                    className="route-btn secondary-btn"
                    onClick={() => openEditPinForm(pin)}
                  >
                    Update Pin
                  </button>
                </article>
              </Popup>
            </Marker>
          ))}

          {userLocation ? (
            <Marker position={userLocation} icon={userIcon}>
              <Popup>You are here</Popup>
            </Marker>
          ) : null}

          {selectedLocation ? (
            <Marker
              position={[selectedLocation.lat, selectedLocation.lng]}
              icon={toiletIcon}
            />
          ) : null}

          {routeCoords.length > 1 ? (
            <Polyline
              positions={routeCoords}
              pathOptions={{
                color: theme === 'dark' ? '#38bdf8' : '#2563eb',
                weight: 5,
                opacity: 0.9,
              }}
            />
          ) : null}
        </MapContainer>

        {selectedLocation && selectedScreenPos ? (
          <form
            className={`modal popup-form anchored-modal ${showBelowPin ? 'below-pin' : ''}`}
            onSubmit={savePin}
            style={anchoredModalStyle}
          >
            <button
              type="button"
              className="modal-close"
              aria-label="Close add pin modal"
              onClick={() => setSelectedLocation(null)}
            >
              ×
            </button>
            <p className="coordinates">
              {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
            </p>
            {formError ? <p className="form-error">{formError}</p> : null}

            <label>
              Location Name
              <input
                type="text"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                required
              />
            </label>

            <label>
              Nearby Landmarks
              <input
                type="text"
                value={form.nearbyLandmarks}
                onChange={(event) =>
                  setForm((current) => ({ ...current, nearbyLandmarks: event.target.value }))
                }
              />
              {reverseLookupLoading ? <small className="hint">Fetching nearby landmark...</small> : null}
            </label>

            <label>
              Rating (1-5)
              <input
                type="number"
                  min="1"
                max="5"
                value={form.rating}
                onChange={(event) =>
                    setForm((current) => ({ ...current, rating: event.target.value }))
                }
                  placeholder="1-5"
                required
              />
            </label>

            <label>
              Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) =>
                  setForm((current) => ({ ...current, price: event.target.value }))
                }
                placeholder={form.isFree ? '0.00' : 'Enter price'}
                disabled={form.isFree}
              />
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={form.isFree}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    isFree: event.target.checked,
                    price: event.target.checked ? '0' : current.price,
                  }))
                }
              />
              Free
            </label>

            <label>
              Images
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) =>
                  setForm((current) => ({ ...current, images: Array.from(event.target.files ?? []) }))
                }
              />
            </label>

            <label>
              Additional Details
              <textarea
                rows="3"
                value={form.details}
                onChange={(event) => setForm((current) => ({ ...current, details: event.target.value }))}
              />
            </label>

            <div className="modal-actions">
              <button type="submit" disabled={saving}>
                {saving ? 'Saving...' : formMode === 'edit' ? 'Update Pin' : 'Save To Map'}
              </button>
            </div>
            <p className="modal-warning">⚠ Unsaved pins will disappear</p>
            <span className="modal-pointer" aria-hidden="true"></span>
          </form>
        ) : null}
      </section>
      {routeSummary ? (
        <p className="status route-summary">
          Route to <strong>{routeSummary.destinationName}</strong>: {routeSummary.distanceKm} km, about{' '}
          {routeSummary.durationMin} min.
        </p>
      ) : null}
      {showAuthModal ? (
        <section className="auth-backdrop">
          <form className="auth-modal" onSubmit={submitAuth}>
            <h3>{authMode === 'signup' ? 'Create Account' : 'Login'}</h3>
            {authError ? <p className="form-error">{authError}</p> : null}
            <label>
              Email
              <input
                type="email"
                value={authForm.email}
                onChange={(event) => setAuthForm((current) => ({ ...current, email: event.target.value }))}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                value={authForm.password}
                onChange={(event) =>
                  setAuthForm((current) => ({ ...current, password: event.target.value }))
                }
                required
              />
            </label>
            <div className="auth-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setShowAuthModal(false)}
              >
                Cancel
              </button>
              <button type="submit" disabled={authLoading}>
                {authLoading
                  ? 'Please wait...'
                  : authMode === 'signup'
                    ? 'Create Account'
                    : 'Login'}
              </button>
            </div>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setAuthMode((current) => (current === 'signup' ? 'login' : 'signup'))
                setAuthError('')
              }}
            >
              {authMode === 'signup'
                ? 'Already have an account? Login'
                : "Don't have an account? Create one"}
            </button>
          </form>
        </section>
      ) : null}
    </main>
  )
}

export default App
