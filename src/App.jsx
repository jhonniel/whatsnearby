import { useEffect, useMemo, useRef, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
import {
  AttributionControl,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import { Bath, Droplets, MirrorRound, Moon, ShowerHead, Sun, Toilet } from 'lucide-react'
import L from 'leaflet'
import './App.css'
import { auth, db, hasFirebaseConfig } from './firebase'
import { LandingPage } from './LandingPage'

const EXTRA_ADMIN_UIDS = (import.meta.env.VITE_ADMIN_UIDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const DEFAULT_CENTER = [7.0731, 125.6128]

const toiletIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Toilet">🚽</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const restaurantIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Restaurant or cafe">🍽️</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const tambayanIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Tambayan spot">🌙</span>',
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

const COMMUNITY_OVERVIEW_COLLECTIONS = ['loos', 'restaurants_cafes', 'tambayan_24h']

/** When adding a pin on the merged map, user picks one of these Firestore collections. */
const COMMUNITY_CREATE_CATEGORIES = [
  { collection: 'loos', label: 'Loo Finder — restrooms & sanitation' },
  { collection: 'restaurants_cafes', label: 'Restaurants & Cafe' },
  { collection: 'tambayan_24h', label: 'Tambayan 24hrs — late-night hangouts' },
]

const MAP_REGISTRY = {
  'community-map': {
    path: '/community-map',
    firestoreCollection: null,
    mergeCollections: COMMUNITY_OVERVIEW_COLLECTIONS,
    mapTitle: 'All community pins',
    tagline:
      'Browse every pin neighbors shared. Click the map to add one—then choose whether it belongs on Loo Finder, Restaurants & Cafe, or Tambayan 24hrs.',
    pinIcon: toiletIcon,
  },
  'loo-finder': {
    path: '/loo-finder-map',
    firestoreCollection: 'loos',
    mapTitle: 'Loo Finder',
    tagline: 'Click map to pin a restroom, then fill the popup form.',
    pinIcon: toiletIcon,
  },
  'restaurants-cafe': {
    path: '/restaurants-cafe-map',
    firestoreCollection: 'restaurants_cafes',
    mapTitle: 'Restaurants & Cafe',
    tagline: 'Click map to pin a spot, then fill the popup form.',
    pinIcon: restaurantIcon,
  },
  'tambayan-24hrs': {
    path: '/tambayan-24hrs-map',
    firestoreCollection: 'tambayan_24h',
    mapTitle: 'Tambayan 24hrs',
    tagline: 'Click map to pin a 24hr hangout, then fill the popup form.',
    pinIcon: tambayanIcon,
  },
  'water-refill': {
    path: '/water-refill-map',
    firestoreCollection: null,
    mapTitle: 'Water Refill',
    tagline: '',
    pinIcon: toiletIcon,
  },
  accessibility: {
    path: '/accessibility-map',
    firestoreCollection: null,
    mapTitle: 'Accessibility',
    tagline: '',
    pinIcon: toiletIcon,
  },
}

/** Wi‑Fi / network fixes; generous timeout + cached fixes reduce false timeouts. */
const GEOLOCATION_READ_OPTIONS = {
  enableHighAccuracy: false,
  maximumAge: 300_000,
  timeout: 90_000,
}

/** Second attempt after TIMEOUT: allow very stale cache and wait longer. */
const GEOLOCATION_RETRY_OPTIONS = {
  enableHighAccuracy: false,
  /* Any cached fix is OK on retry so the browser can answer immediately */
  maximumAge: 86_400_000,
  timeout: 120_000,
}

function mapIdToPath(mapId) {
  return MAP_REGISTRY[mapId]?.path ?? '/'
}

function pathToMapId(pathname) {
  const entry = Object.entries(MAP_REGISTRY).find(([, cfg]) => cfg.path === pathname)
  return entry ? entry[0] : null
}

function pinsCollectionForMapId(mapId) {
  return MAP_REGISTRY[mapId]?.firestoreCollection ?? null
}

function mergeCollectionsForMapId(mapId) {
  return MAP_REGISTRY[mapId]?.mergeCollections ?? null
}

function pinFirestoreCollection(pin) {
  return pin.collection || null
}

function markerIconForPin(pin, fallbackIcon) {
  const c = pinFirestoreCollection(pin)
  if (c === 'restaurants_cafes') return restaurantIcon
  if (c === 'tambayan_24h') return tambayanIcon
  return fallbackIcon ?? toiletIcon
}

function pinBusyKey(pin) {
  return `${pinFirestoreCollection(pin) ?? 'local'}:${pin.id}`
}

function mapLayerLabel(collection) {
  if (collection === 'restaurants_cafes') return 'Restaurants & Cafe'
  if (collection === 'tambayan_24h') return 'Tambayan 24hrs'
  if (collection === 'loos') return 'Loo Finder'
  return 'Map pin'
}

/** Treat existing `rating` as one vote when ratingCount / ratingSum are missing. */
function ratingStatsFromDocData(data) {
  const raw = Number(data?.rating)
  const fallbackStar =
    Number.isFinite(raw) && raw >= 1 && raw <= 5 ? Math.round(raw) : 3
  const prevCount =
    Number.isFinite(Number(data?.ratingCount)) && Number(data.ratingCount) >= 1
      ? Math.floor(Number(data.ratingCount))
      : 1
  const prevSum = Number.isFinite(Number(data?.ratingSum))
    ? Number(data.ratingSum)
    : fallbackStar * prevCount
  return { prevCount, prevSum }
}

function clampStarRating(n) {
  const x = Math.round(Number(n))
  if (Number.isNaN(x)) return 3
  return Math.min(5, Math.max(1, x))
}

const LOO_AMENITY_FIELDS = [
  { key: 'bidet', label: 'BeDiet', Icon: Bath },
  { key: 'shower', label: 'Shower', Icon: ShowerHead },
  { key: 'cleanWater', label: 'Clean Water', Icon: Droplets },
  { key: 'cleanToilet', label: 'Clean Toilet', Icon: Toilet },
  { key: 'mirror', label: 'Mirror', Icon: MirrorRound },
]

function loosAmenityValues(form) {
  return {
    bidet: Boolean(form.bidet),
    shower: Boolean(form.shower),
    cleanWater: Boolean(form.cleanWater),
    cleanToilet: Boolean(form.cleanToilet),
    mirror: Boolean(form.mirror),
  }
}

function shouldIncludeLoosAmenities({
  formMode,
  activeMapId,
  newPinCategory,
  editingPinCollection,
}) {
  if (activeMapId === 'loo-finder') return true
  if (activeMapId !== 'community-map') return false
  if (formMode === 'edit') return editingPinCollection === 'loos'
  return newPinCategory === 'loos'
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

function LocateMap({ center, zoom = 14 }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, zoom)
  }, [center, map, zoom])
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

/** Leaflet needs a size refresh when the map pane goes full-viewport or flex layout changes. */
function MapInvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const invalidate = () => map.invalidateSize({ animate: false })
    invalidate()
    const ro = new ResizeObserver(invalidate)
    ro.observe(el)
    window.addEventListener('resize', invalidate)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', invalidate)
    }
  }, [map])
  return null
}

function MapInstanceBridge({ onMapReady }) {
  const map = useMap()
  useEffect(() => {
    onMapReady(map)
  }, [map, onMapReady])
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
  const activeMapIdRef = useRef(null)
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
  const [mapInstance, setMapInstance] = useState(null)
  const [anchoredModalStyle, setAnchoredModalStyle] = useState({})
  const [showBelowPin, setShowBelowPin] = useState(false)
  const [theme, setTheme] = useState(
    () => localStorage.getItem('whatsnearby-theme') || localStorage.getItem('loo-theme') || 'light',
  )
  const [routeCoords, setRouteCoords] = useState([])
  const [routeSummary, setRouteSummary] = useState(null)
  const [routingForPinId, setRoutingForPinId] = useState(null)
  const [activeMapId, setActiveMapId] = useState(() => pathToMapId(window.location.pathname))
  const [currentUser, setCurrentUser] = useState(null)
  const [docAdmin, setDocAdmin] = useState(false)
  const [adminBusyPinId, setAdminBusyPinId] = useState(null)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ email: '', password: '' })
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [pendingEditPin, setPendingEditPin] = useState(null)
  const [formMode, setFormMode] = useState('create')
  const [editingPinId, setEditingPinId] = useState(null)
  const [editingPinCollection, setEditingPinCollection] = useState(null)
  const [newPinCategory, setNewPinCategory] = useState('')
  const [quickRatingBusyKey, setQuickRatingBusyKey] = useState(null)
  const [form, setForm] = useState({
    name: '',
    nearbyLandmarks: '',
    rating: '',
    price: '',
    isFree: false,
    details: '',
    images: [],
    bidet: false,
    shower: false,
    cleanWater: false,
    cleanToilet: false,
    mirror: false,
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
    if (!hasFirebaseConfig || !db || !currentUser) {
      return undefined
    }
    const adminRef = doc(db, 'admins', currentUser.uid)
    const unsubscribe = onSnapshot(
      adminRef,
      (snapshot) => {
        setDocAdmin(snapshot.exists())
      },
      () => {
        setDocAdmin(false)
      },
    )
    return () => {
      unsubscribe()
      setDocAdmin(false)
    }
  }, [currentUser])

  useEffect(() => {
    let unsubscribe = () => {}
    const frameId = requestAnimationFrame(() => {
      setRemotePins([])
      setLocalPins([])
      setRouteCoords([])
      setRouteSummary(null)
      setSelectedLocation(null)
      setSelectedScreenPos(null)
      setFormMode('create')
      setEditingPinId(null)
      setEditingPinCollection(null)
      setNewPinCategory('')
      setFilterRating('all')

      if (!hasFirebaseConfig) {
        setLoadingPins(false)
        return
      }

      const mergeCols = mergeCollectionsForMapId(activeMapId)
      if (mergeCols && mergeCols.length > 0) {
        setLoadingPins(true)
        const slices = {}
        const pushMerged = () => {
          const merged = mergeCols.flatMap((c) => slices[c] ?? [])
          const remoteKeys = new Set(merged.map((p) => pinBusyKey(p)))
          setRemotePins(merged)
          setLocalPins((current) => current.filter((pin) => !remoteKeys.has(pinBusyKey(pin))))
          setLoadingPins(false)
        }
        const unsubs = mergeCols.map((collName) => {
          const q = query(collection(db, collName), orderBy('createdAt', 'desc'))
          return onSnapshot(
            q,
            (snapshot) => {
              slices[collName] = snapshot.docs.map((item) => ({
                ...item.data(),
                id: item.id,
                collection: collName,
              }))
              pushMerged()
            },
            () => {
              setError('Unable to read Firebase data. Local pin mode is still available.')
              slices[collName] = []
              pushMerged()
            },
          )
        })
        unsubscribe = () => {
          unsubs.forEach((u) => u())
        }
      } else {
        const coll = pinsCollectionForMapId(activeMapId)
        if (!coll) {
          setLoadingPins(false)
          return
        }

        setLoadingPins(true)
        const q = query(collection(db, coll), orderBy('createdAt', 'desc'))
        unsubscribe = onSnapshot(
          q,
          (snapshot) => {
            const nextRemotePins = snapshot.docs.map((item) => ({
              ...item.data(),
              id: item.id,
              collection: coll,
            }))
            const remoteKeys = new Set(nextRemotePins.map((pin) => pinBusyKey(pin)))
            setRemotePins(nextRemotePins)
            setLocalPins((current) => current.filter((pin) => !remoteKeys.has(pinBusyKey(pin))))
            setLoadingPins(false)
          },
          () => {
            setError('Unable to read Firebase data. Local pin mode is still available.')
            setLoadingPins(false)
          },
        )
      }
    })

    return () => {
      cancelAnimationFrame(frameId)
      unsubscribe()
    }
  }, [activeMapId])

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const current = [position.coords.latitude, position.coords.longitude]
        setMapCenter(current)
        setUserLocation(current)
      },
      () => {},
      GEOLOCATION_READ_OPTIONS,
    )
  }, [])

  useEffect(() => {
    activeMapIdRef.current = activeMapId
  }, [activeMapId])

  useEffect(() => {
    if (!navigator.geolocation) return undefined
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const current = [position.coords.latitude, position.coords.longitude]
        setUserLocation(current)
        if (activeMapIdRef.current) {
          setMapCenter(current)
        }
      },
      () => {},
      {
        enableHighAccuracy: false,
        maximumAge: 300_000,
        timeout: 120_000,
      },
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  useEffect(() => {
    if (!activeMapId || !userLocation) return undefined
    const id = requestAnimationFrame(() => setMapCenter(userLocation))
    return () => cancelAnimationFrame(id)
  }, [activeMapId, userLocation])

  const envAdmin = Boolean(
    currentUser && EXTRA_ADMIN_UIDS.includes(currentUser.uid),
  )
  const isAdmin = envAdmin || docAdmin

  const pins = useMemo(() => [...localPins, ...remotePins], [localPins, remotePins])
  const activePinsCollection = useMemo(() => pinsCollectionForMapId(activeMapId), [activeMapId])
  const activeMapConfig = MAP_REGISTRY[activeMapId] ?? MAP_REGISTRY['loo-finder']
  const pinMarkerIcon = activeMapConfig.pinIcon ?? toiletIcon

  const visiblePins = useMemo(() => {
    if (filterRating === 'all') return pins
    return pins.filter((pin) => pin.rating >= Number(filterRating))
  }, [pins, filterRating])

  const showLooAmenitiesFieldset = useMemo(
    () =>
      shouldIncludeLoosAmenities({
        formMode,
        activeMapId,
        newPinCategory,
        editingPinCollection,
      }),
    [formMode, activeMapId, newPinCategory, editingPinCollection],
  )

  const locateMe = () => {
    if (!navigator.geolocation) {
      setError('This browser does not support location.')
      return
    }
    setIsLocating(true)
    setError('')

    const finishError = (err) => {
      setIsLocating(false)
      const code = err?.code
      if (code === 1) {
        setError('Location permission was blocked. Allow location for this site in your browser settings.')
      } else if (code === 2) {
        setError('Your device could not determine position. Try again, disable VPN, or use mobile data / GPS.')
      } else if (code === 3) {
        setError(
          'Location is still loading or unavailable on this network. Wait up to two minutes and tap Locate Me again, try another network, or open the site over HTTPS (not a raw LAN IP).',
        )
      } else {
        setError('Unable to fetch your location. Try again in a moment.')
      }
    }

    const onOk = (position) => {
      const current = [position.coords.latitude, position.coords.longitude]
      setMapCenter(current)
      setUserLocation(current)
      setIsLocating(false)
      setError('')
    }

    navigator.geolocation.getCurrentPosition(onOk, (err) => {
      if (err?.code === 3) {
        navigator.geolocation.getCurrentPosition(onOk, finishError, GEOLOCATION_RETRY_OPTIONS)
        return
      }
      finishError(err)
    }, GEOLOCATION_READ_OPTIONS)
  }

  const reverseGeocode = async (lat, lng, options = {}) => {
    const mergeForm = options.mergeForm !== false
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

      if (mergeForm) {
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
      }
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

    if (formMode === 'edit' && editingPinId && currentUser) {
      const reverseResult = await reverseGeocode(latlng.lat, latlng.lng, { mergeForm: false })
      if (reverseResult?.blocked) {
        setError('Location cannot be pinned (sea/lake/river).')
        return
      }
      setSelectedLocation(latlng)
      return
    }

    setFormMode('create')
    setEditingPinId(null)
    setEditingPinCollection(null)
    setNewPinCategory('')
    setForm({
      name: '',
      nearbyLandmarks: '',
      rating: '',
      price: '',
      isFree: false,
      details: '',
      images: [],
      bidet: false,
      shower: false,
      cleanWater: false,
      cleanToilet: false,
      mirror: false,
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
    localStorage.setItem('whatsnearby-theme', theme)
  }, [theme])

  const openEditPinForm = (pin) => {
    if (!currentUser) {
      setPendingEditPin(pin)
      setShowAuthModal(true)
      setAuthMode('login')
      setAuthError('')
      return
    }

    if (!isAdmin) {
      if (pin.ownerUid && pin.ownerUid !== currentUser.uid) {
        setError('Only the account that created this pin can update it.')
        return
      }
    }

    setFormMode('edit')
    setEditingPinId(pin.id)
    setNewPinCategory('')
    setEditingPinCollection(pinFirestoreCollection(pin) || activePinsCollection || null)
    setSelectedLocation({ lat: pin.latitude, lng: pin.longitude })
    setForm({
      name: pin.name || '',
      nearbyLandmarks: pin.nearbyLandmarks || '',
      rating: pin.rating ? String(pin.rating) : '',
      price: pin.price != null ? String(pin.price) : '',
      isFree: Boolean(pin.isFree),
      details: pin.details || '',
      images: [],
      bidet: Boolean(pin.bidet),
      shower: Boolean(pin.shower),
      cleanWater: Boolean(pin.cleanWater),
      cleanToilet: Boolean(pin.cleanToilet),
      mirror: Boolean(pin.mirror),
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
    setRoutingForPinId(pinBusyKey(pin))

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
        throw new Error('No route found to this destination.')
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

  const submitAnonymousRating = async (pin, stars) => {
    const coll = pinFirestoreCollection(pin) || activePinsCollection
    if (!coll || pin.localOnly || !hasFirebaseConfig || !db) return
    const key = pinBusyKey(pin)
    setQuickRatingBusyKey(key)
    setError('')
    setNotice('')
    try {
      const ref = doc(db, coll, pin.id)
      const snap = await getDoc(ref)
      if (!snap.exists()) {
        setError('That pin could not be found.')
        return
      }
      const d = snap.data()
      const { prevCount, prevSum } = ratingStatsFromDocData(d)
      const vote = clampStarRating(stars)
      const newCount = prevCount + 1
      const newSum = prevSum + vote
      const newRating = clampStarRating(newSum / newCount)

      await withTimeout(
        updateDoc(ref, {
          rating: newRating,
          ratingCount: newCount,
          ratingSum: newSum,
          updatedAt: serverTimestamp(),
        }),
        10000,
        'Rating update timed out.',
      )

      setRemotePins((current) =>
        current.map((p) =>
          pinBusyKey(p) === key
            ? { ...p, rating: newRating, ratingCount: newCount, ratingSum: newSum }
            : p,
        ),
      )
      setNotice('Thanks—your rating was added (averaged with others, 1–5 stars).')
    } catch (e) {
      setError(e?.message || 'Could not save rating.')
    } finally {
      setQuickRatingBusyKey(null)
    }
  }

  const verifyPinAsAdmin = async (pin) => {
    const coll = pinFirestoreCollection(pin) || activePinsCollection
    if (!coll || !isAdmin || !hasFirebaseConfig || !db || !auth?.currentUser || pin.localOnly) return
    setAdminBusyPinId(pinBusyKey(pin))
    setError('')
    setNotice('')
    try {
      await withTimeout(
        updateDoc(doc(db, coll, pin.id), {
          verified: true,
          verifiedAt: serverTimestamp(),
          verifiedByUid: auth.currentUser.uid,
        }),
        10000,
        'Verification timed out.',
      )
      setNotice('Pin marked as verified.')
    } catch (verifyError) {
      setError(verifyError?.message || 'Could not verify pin.')
    } finally {
      setAdminBusyPinId(null)
    }
  }

  const deletePinAsAdmin = async (pin) => {
    if (!isAdmin) return
    const coll = pinFirestoreCollection(pin) || activePinsCollection
    if (!pin.localOnly && !coll) return
    if (!window.confirm(`Delete “${pin.name}” permanently?`)) return
    setAdminBusyPinId(pinBusyKey(pin))
    setError('')
    setNotice('')
    try {
      if (pin.localOnly) {
        setLocalPins((current) => current.filter((item) => item.id !== pin.id))
        setNotice('Local pin removed.')
        return
      }
      if (!hasFirebaseConfig || !db) {
        setError('Firebase is not configured.')
        return
      }
      await withTimeout(deleteDoc(doc(db, coll, pin.id)), 10000, 'Delete timed out.')
      setNotice('Pin removed.')
    } catch (deleteError) {
      setError(deleteError?.message || 'Could not delete pin.')
    } finally {
      setAdminBusyPinId(null)
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

    if (formMode !== 'edit' && activeMapId === 'community-map') {
      if (!newPinCategory || !COMMUNITY_OVERVIEW_COLLECTIONS.includes(newPinCategory)) {
        setFormError('Pick which topic map this pin belongs to.')
        return
      }
    }

    setSaving(true)
    setError('')
    setNotice('')
    setFormError('')

    if (formMode !== 'edit' && hasFirebaseConfig) {
      if (activeMapId !== 'community-map' && !activePinsCollection) {
        setFormError('This map is not connected to Firebase yet.')
        setSaving(false)
        return
      }
    }

    const createTargetCollection =
      formMode !== 'edit'
        ? activeMapId === 'community-map'
          ? newPinCategory
          : activePinsCollection
        : null

    const loosAmenities = showLooAmenitiesFieldset ? loosAmenityValues(form) : {}

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
      ...(createTargetCollection ? { collection: createTargetCollection } : {}),
      ...loosAmenities,
    }
    if (formMode === 'edit') {
      if (!currentUser) {
        setFormError('Login required to update pins.')
        setShowAuthModal(true)
        setSaving(false)
        return
      }

      const targetId = editingPinId
      if (!targetId) {
        setFormError('No pin selected for update.')
        return
      }

      const priorPin = pins.find(
        (p) =>
          p.id === targetId &&
          (editingPinCollection == null || pinFirestoreCollection(p) === editingPinCollection),
      )
      const writeColl = editingPinCollection || pinFirestoreCollection(priorPin) || activePinsCollection
      if (!writeColl) {
        setFormError('This map is not connected to Firebase yet.')
        setSaving(false)
        return
      }

      const claimOwner = Boolean(priorPin && !priorPin.ownerUid && currentUser?.uid)

      setLocalPins((current) =>
        current.map((pin) =>
          pin.id === targetId
            ? { ...pin, ...optimisticPin, id: targetId, ...(claimOwner ? { ownerUid: currentUser.uid } : {}) }
            : pin,
        ),
      )

      try {
        await withTimeout(
          updateDoc(doc(db, writeColl, targetId), {
            name: optimisticPin.name,
            nearbyLandmarks: optimisticPin.nearbyLandmarks,
            rating: optimisticPin.rating,
            price: optimisticPin.price,
            isFree: optimisticPin.isFree,
            details: optimisticPin.details,
            latitude: selectedLocation.lat,
            longitude: selectedLocation.lng,
            ...(writeColl === 'loos' ? loosAmenityValues(form) : {}),
            ...(claimOwner ? { ownerUid: currentUser.uid } : {}),
            updatedAt: serverTimestamp(),
          }),
          10000,
          'Update timed out. Check internet or Firestore rules.',
        )
        setRemotePins((current) =>
          current.map((pin) =>
            pin.id === targetId && pinFirestoreCollection(pin) === writeColl
              ? {
                  ...pin,
                  name: optimisticPin.name,
                  nearbyLandmarks: optimisticPin.nearbyLandmarks,
                  rating: optimisticPin.rating,
                  price: optimisticPin.price,
                  isFree: optimisticPin.isFree,
                  details: optimisticPin.details,
                  latitude: selectedLocation.lat,
                  longitude: selectedLocation.lng,
                  ...(writeColl === 'loos' ? loosAmenityValues(form) : {}),
                  ...(claimOwner ? { ownerUid: currentUser.uid } : {}),
                }
              : pin,
          ),
        )
        setNotice('Pin updated successfully.')
        setSelectedLocation(null)
        setFormMode('create')
        setEditingPinId(null)
        setEditingPinCollection(null)
        setNewPinCategory('')
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
    setNewPinCategory('')

    if (!hasFirebaseConfig) {
      setNotice('Pin saved locally only. Add Firebase credentials to sync online.')
      setSaving(false)
      return
    }

    let syncedPinId = null
    try {
      const pinRef = doc(collection(db, createTargetCollection))
      const syncedOptimisticPin = {
        ...optimisticPin,
        id: pinRef.id,
        localOnly: false,
        collection: createTargetCollection,
        ratingCount: 1,
        ratingSum: numericRating,
      }
      syncedPinId = pinRef.id
      setLocalPins((current) => [
        syncedOptimisticPin,
        ...current.filter((pin) => pin.id !== tempId),
      ])

      const pinDocFields = { ...syncedOptimisticPin }
      delete pinDocFields.collection
      await withTimeout(
        setDoc(pinRef, {
          ...pinDocFields,
          id: pinRef.id,
          ratingCount: 1,
          ratingSum: numericRating,
          ...(currentUser ? { ownerUid: currentUser.uid } : {}),
          verified: false,
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

    const margin = 12
    const preferredWidth = 392
    const estimatedModalHeight = 480
    const anchorOffset = 24

    function layoutAnchoredModal() {
      const shell = mapShellRef.current
      if (!shell || !selectedScreenPos) return

      const shellRect = shell.getBoundingClientRect()
      const narrow = typeof window !== 'undefined' && window.innerWidth <= 768
      const marginX = narrow ? 8 : margin
      const appShell = shell.closest('main.app-shell')
      const topChromeEl = appShell?.querySelector('.map-chrome-layer')
      const footerEl = appShell?.querySelector('.map-footer-layer')
      const topChromeReserve =
        topChromeEl && typeof topChromeEl.getBoundingClientRect === 'function'
          ? topChromeEl.getBoundingClientRect().height + 10
          : margin
      const footerReserve =
        footerEl && typeof footerEl.getBoundingClientRect === 'function'
          ? footerEl.getBoundingClientRect().height + 10
          : 52
      const modalWidth = Math.max(280, Math.min(preferredWidth, shellRect.width - marginX * 2))
      const leftMin = modalWidth / 2 + marginX
      const leftMax = shellRect.width - modalWidth / 2 - marginX
      const left = Math.min(Math.max(selectedScreenPos.x, leftMin), leftMax)

      const availableAbove = selectedScreenPos.y - topChromeReserve
      const availableBelow = shellRect.height - selectedScreenPos.y - margin - footerReserve
      const placeBelow = availableAbove < estimatedModalHeight && availableBelow > availableAbove
      const top = placeBelow
        ? Math.min(selectedScreenPos.y + anchorOffset, shellRect.height - margin - footerReserve)
        : Math.max(selectedScreenPos.y - anchorOffset, topChromeReserve)
      const maxHeight = Math.max(220, (placeBelow ? availableBelow : availableAbove) - 14)

      setShowBelowPin(placeBelow)
      setAnchoredModalStyle({
        left: `${left}px`,
        top: `${top}px`,
        width: `${modalWidth}px`,
        maxHeight: `${maxHeight}px`,
        transform: placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
      })
    }

    layoutAnchoredModal()
    window.addEventListener('resize', layoutAnchoredModal)
    window.addEventListener('orientationchange', layoutAnchoredModal)
    return () => {
      window.removeEventListener('resize', layoutAnchoredModal)
      window.removeEventListener('orientationchange', layoutAnchoredModal)
    }
  }, [selectedLocation, selectedScreenPos])

  useEffect(() => {
    if (!selectedLocation || !mapShellRef.current || !mapInstance) return

    const appShell = mapShellRef.current.closest('main.app-shell')

    const topChromeEl = appShell?.querySelector('.map-chrome-layer')
    const footerEl = appShell?.querySelector('.map-footer-layer')
    const dockEl = appShell?.querySelector('.map-toolbar-dock')
    const quickActionsEl = appShell?.querySelector('.map-quick-actions--floating')
    const noticesEl = appShell?.querySelector('.map-notice-stack')

    const visibleHeight = (el) => {
      if (!el || !(el instanceof HTMLElement)) return 0
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return 0
      return el.getBoundingClientRect().height
    }

    const topSafe = visibleHeight(topChromeEl) + 14
    const bottomSafe =
      visibleHeight(footerEl) +
      visibleHeight(dockEl) +
      visibleHeight(quickActionsEl) +
      visibleHeight(noticesEl) +
      18

    // Keep the selected marker inside a safe viewport without aggressive pan loops.
    mapInstance.panInside([selectedLocation.lat, selectedLocation.lng], {
      paddingTopLeft: [18, topSafe],
      paddingBottomRight: [18, bottomSafe],
      animate: true,
      duration: 0.25,
    })
  }, [mapInstance, selectedLocation, showAuthModal])

  if (!activeMapId) {
    return (
      <LandingPage
        theme={theme}
        setTheme={setTheme}
        userLocation={userLocation}
        onOpenMap={setActiveMapId}
      />
    )
  }

  return (
    <main className={`app-shell ${theme === 'dark' ? 'dark' : ''}`}>
      <div className="map-chrome-layer">
      <header className="top-bar">
        <div className="brand-block">
          <img
            className="app-nav-logo"
            src="/whatsnearby-logo.png"
            alt="whatsnearby"
            width={200}
            height={48}
            decoding="async"
          />
          <div className="brand-block-titles">
            <h1>{activeMapConfig.mapTitle}</h1>
            <p>{activeMapConfig.tagline || 'Click map to pin, then fill the popup form.'}</p>
          </div>
        </div>
        <div className="top-bar-actions map-toolbar-dock" aria-label="Map tools">
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
            <div className="map-quick-actions map-quick-actions--inline">
              <button type="button" className="secondary" onClick={locateMe} disabled={isLocating}>
                {isLocating ? (
                  <span className="locate-loading">
                    <span className="locate-loading-spinner" aria-hidden="true"></span>
                    Locating...
                  </span>
                ) : (
                  'Locate Me'
                )}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => openPinForm({ lat: visibleCenter[0], lng: visibleCenter[1] })}
              >
                Pin At Center
              </button>
            </div>
            <label className="theme-toggle" aria-label="Toggle light or dark mode">
              <input
                type="checkbox"
                checked={theme === 'dark'}
                onChange={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
              />
              <span className="toggle-track">
                <span className="toggle-track-icons" aria-hidden>
                  <span className="toggle-icon toggle-icon-sun">
                    <Sun size={14} strokeWidth={2} />
                  </span>
                  <span className="toggle-icon toggle-icon-moon">
                    <Moon size={14} strokeWidth={2} />
                  </span>
                </span>
                <span className="toggle-thumb">
                  <span className="toggle-thumb-icon toggle-thumb-sun">
                    <Sun size={14} strokeWidth={2.25} />
                  </span>
                  <span className="toggle-thumb-icon toggle-thumb-moon">
                    <Moon size={14} strokeWidth={2.25} />
                  </span>
                </span>
              </span>
            </label>
            {currentUser ? (
              <>
                {isAdmin ? <span className="admin-pill">Admin</span> : null}
                <button type="button" className="secondary" onClick={handleLogout}>
                  Logout
                </button>
              </>
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

      </div>

      <div className="map-quick-actions map-quick-actions--floating" aria-label="Map position tools">
        <button type="button" className="secondary" onClick={() => setActiveMapId(null)}>
          Home
        </button>
        <button type="button" className="secondary" onClick={locateMe} disabled={isLocating}>
          {isLocating ? (
            <span className="locate-loading">
              <span className="locate-loading-spinner" aria-hidden="true"></span>
              Locating...
            </span>
          ) : (
            'Locate Me'
          )}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => openPinForm({ lat: visibleCenter[0], lng: visibleCenter[1] })}
        >
          Pin At Center
        </button>
      </div>
      {!selectedLocation && !showAuthModal ? (
        <div className="map-notice-stack" aria-live="polite" aria-atomic="true">
          {error ? <p className="map-notice map-notice--error">{error}</p> : null}
          {notice ? <p className="map-notice map-notice--warning">{notice}</p> : null}
          {routeSummary ? (
            <p className="map-notice map-notice--info">
              Route to <strong>{routeSummary.destinationName}</strong>: {routeSummary.distanceKm} km, about{' '}
              {routeSummary.durationMin} min.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="map-shell" ref={mapShellRef}>
        <MapContainer
          center={mapCenter}
          zoom={14}
          minZoom={12}
          className="map"
          tap={false}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
        >
          <MapInstanceBridge onMapReady={setMapInstance} />
          <MapInvalidateOnResize />
          <LocateMap center={mapCenter} zoom={14} />
          <MapEvents onMapClick={openPinForm} onCenterChange={setVisibleCenter} />
          <SelectedPinOverlayTracker
            selectedLocation={selectedLocation}
            onPositionChange={setSelectedScreenPos}
          />
          <AttributionControl position="bottomleft" prefix={false} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            url={
              theme === 'dark'
                ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
                : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
            }
          />

          {visiblePins.map((pin) => (
            <Marker
              key={pinBusyKey(pin)}
              position={[pin.latitude, pin.longitude]}
              icon={markerIconForPin(pin, pinMarkerIcon)}
            >
              <Popup maxWidth={280}>
                <article className="popup-content">
                  {pin.collection ? (
                    <p className="hint" style={{ marginBottom: '0.35rem' }}>
                      {mapLayerLabel(pin.collection)}
                    </p>
                  ) : null}
                  <h3>{pin.name}</h3>
                  <p>{pin.nearbyLandmarks || 'No nearby landmark'}</p>
                  <Stars value={pin.rating} />
                  {!pin.localOnly && hasFirebaseConfig ? (
                    <div className="quick-rate">
                      <p className="quick-rate-label">Add your rating (no sign-in required)</p>
                      <div className="quick-rate-row" role="group" aria-label="Rate from 1 to 5 stars">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            className={`quick-rate-star ${pin.rating >= n ? 'is-on' : ''}`}
                            onClick={() => submitAnonymousRating(pin, n)}
                            disabled={quickRatingBusyKey === pinBusyKey(pin)}
                            aria-label={`Rate ${n} out of 5`}
                          >
                            <span aria-hidden>★</span>
                          </button>
                        ))}
                      </div>
                      {Number(pin.ratingCount) > 1 ? (
                        <p className="quick-rate-meta">
                          From {pin.ratingCount} ratings (shown as a 1–5 average).
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {Array.isArray(pin.imageUrls) && pin.imageUrls.length > 0 ? (
                    <div className="gallery">
                      {pin.imageUrls.map((url) => (
                        <img key={url} src={url} alt={pin.name} loading="lazy" />
                      ))}
                    </div>
                  ) : null}
                  <p>{pin.details || 'No additional details.'}</p>
                  {(pinFirestoreCollection(pin) || activePinsCollection) === 'loos' &&
                  LOO_AMENITY_FIELDS.some(({ key }) => pin[key]) ? (
                    <div className="loo-amenity-icons-row" role="list" aria-label="Amenities">
                      {LOO_AMENITY_FIELDS.filter(({ key }) => pin[key]).map(({ key, label, Icon }) => (
                        <span key={key} className="loo-amenity-icon-badge" role="listitem" title={label}>
                          <Icon size={18} strokeWidth={1.75} aria-hidden />
                          <span className="visually-hidden">{label}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <p className="price-info">
                    {pin.isFree ? 'Free' : `Price: ₱${Number(pin.price || 0).toFixed(2)}`}
                  </p>
                  {pin.verified ? (
                    <p className="verified-line">Verified listing</p>
                  ) : (
                    <p className="unverified-line">Not yet verified</p>
                  )}
                  {pin.localOnly ? <small className="hint">Local only</small> : null}
                  {isAdmin ? (
                    <div className="admin-pin-actions">
                      {!pin.localOnly && !pin.verified ? (
                        <button
                          type="button"
                          className="route-btn admin-verify-btn"
                          onClick={() => verifyPinAsAdmin(pin)}
                          disabled={adminBusyPinId === pinBusyKey(pin)}
                        >
                          {adminBusyPinId === pinBusyKey(pin) ? 'Working…' : 'Verify data'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="route-btn admin-delete-btn"
                        onClick={() => deletePinAsAdmin(pin)}
                        disabled={adminBusyPinId === pinBusyKey(pin)}
                      >
                        {adminBusyPinId === pinBusyKey(pin) ? 'Working…' : 'Delete pin'}
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="route-btn"
                    onClick={() => getBestRouteToPin(pin)}
                    disabled={routingForPinId === pinBusyKey(pin)}
                  >
                    {routingForPinId === pinBusyKey(pin) ? 'Routing...' : 'Get Directions'}
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
              icon={
                formMode === 'create' && activeMapId === 'community-map' && newPinCategory
                  ? markerIconForPin({ collection: newPinCategory }, pinMarkerIcon)
                  : pinMarkerIcon
              }
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
        {loadingPins ? (
          <div className="map-loading-overlay" role="status" aria-live="polite">
            <div className="map-loading-card">
              <div className="map-loading-emblem" aria-hidden="true">
                <span className="map-loading-ripple map-loading-ripple--one"></span>
                <span className="map-loading-ripple map-loading-ripple--two"></span>
                <span className="map-loading-pin map-loading-pin--left">📍</span>
                <span className="map-loading-pin map-loading-pin--center">📍</span>
                <span className="map-loading-pin map-loading-pin--right">📍</span>
              </div>
              <p className="map-loading-title">Loading pins</p>
              <p className="map-loading-subtitle">Fetching nearby community pins...</p>
            </div>
          </div>
        ) : null}
        {isLocating ? (
          <div className="map-locate-overlay" role="status" aria-live="polite">
            <div className="map-locate-card">
              <span className="map-locate-pulse map-locate-pulse--one" aria-hidden="true"></span>
              <span className="map-locate-pulse map-locate-pulse--two" aria-hidden="true"></span>
              <span className="map-locate-dot" aria-hidden="true"></span>
              <p className="map-locate-title">Locating you</p>
              <p className="map-locate-subtitle">Getting your current position...</p>
            </div>
          </div>
        ) : null}

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
              onClick={() => {
                setSelectedLocation(null)
                setNewPinCategory('')
              }}
            >
              ×
            </button>
            <p className="coordinates">
              {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
            </p>
            {formError ? <p className="form-error">{formError}</p> : null}

            {formMode === 'create' && activeMapId === 'community-map' ? (
              <fieldset className="pin-category-fieldset">
                <legend>Which topic map?</legend>
                <p className="pin-category-hint">Choose where this pin is saved.</p>
                {COMMUNITY_CREATE_CATEGORIES.map(({ collection, label }) => (
                  <label key={collection} className="pin-category-option">
                    <input
                      type="radio"
                      name="newPinCategory"
                      value={collection}
                      checked={newPinCategory === collection}
                      onChange={() => setNewPinCategory(collection)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}

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

            <div className="form-rating-field">
              <span className="form-rating-label">Rating (1–5)</span>
              <div className="form-rating-row" role="group" aria-label="Your rating from 1 to 5 stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`form-rating-star ${Number(form.rating) >= n ? 'is-on' : ''}`}
                    onClick={() => setForm((current) => ({ ...current, rating: String(n) }))}
                    aria-label={`Set rating to ${n} out of 5`}
                  >
                    <span aria-hidden>★</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="price-with-free-field">
              <span className="price-with-free-label">Price</span>
              <div className="price-with-free-row">
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
                  aria-label="Price in pesos"
                />
                <label className="checkbox-field price-free-checkbox">
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
                  <span>Free</span>
                </label>
              </div>
            </div>

            {showLooAmenitiesFieldset ? (
              <fieldset className="pin-category-fieldset loo-amenities-fieldset">
                <legend>Amenities</legend>
                <p className="pin-category-hint">What’s available at this restroom?</p>
                {LOO_AMENITY_FIELDS.map(({ key, label }) => (
                  <label key={key} className="checkbox-field pin-category-option loo-amenity-option">
                    <input
                      type="checkbox"
                      checked={Boolean(form[key])}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, [key]: event.target.checked }))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            ) : null}

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
          </form>
        ) : null}
      </section>
      <footer className="map-footer-layer" role="contentinfo" aria-label="Site footer">
        <small className="map-footer-copy">
          © {new Date().getFullYear()} whatsnearby — community maps for everyday needs.
        </small>
      </footer>
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
