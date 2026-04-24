import { useEffect, useMemo, useState } from 'react'
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
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import './App.css'
import { db, hasFirebaseConfig, storage } from './firebase'

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

function App() {
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
  const [filterRating, setFilterRating] = useState('all')
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [form, setForm] = useState({
    name: '',
    nearbyLandmarks: '',
    rating: 0,
    details: '',
    images: [],
  })

  useEffect(() => {
    if (!hasFirebaseConfig) {
      return undefined
    }

    const q = query(collection(db, 'loos'), orderBy('createdAt', 'desc'))
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRemotePins(
          snapshot.docs.map((item) => ({
            id: item.id,
            ...item.data(),
          })),
        )
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
      setForm((current) => ({
        ...current,
        nearbyLandmarks: current.nearbyLandmarks || data?.display_name || '',
      }))
    } catch {
      setError('Could not fetch nearby landmark automatically.')
    } finally {
      setReverseLookupLoading(false)
    }
  }

  const openPinForm = (latlng) => {
    setError('')
    setNotice('')
    setSelectedLocation(latlng)
    setForm({
      name: '',
      nearbyLandmarks: '',
      rating: 0,
      details: '',
      images: [],
    })
    reverseGeocode(latlng.lat, latlng.lng)
  }

  const uploadImages = async (files, pinId) => {
    const uploads = files.map(async (file, index) => {
      const imageRef = ref(storage, `loos/${pinId}/${Date.now()}-${index}-${file.name}`)
      const snapshot = await uploadBytes(imageRef, file)
      return getDownloadURL(snapshot.ref)
    })
    return Promise.all(uploads)
  }

  const savePin = async (event) => {
    event.preventDefault()
    if (!selectedLocation) return
    if (!form.name.trim()) {
      setError('Location name is required.')
      return
    }
    if (form.rating < 1 || form.rating > 5) {
      setError('Please set a rating between 1 and 5.')
      return
    }

    setSaving(true)
    setError('')
    setNotice('')

    const tempId = `local-${Date.now()}`
    const optimisticPin = {
      id: tempId,
      name: form.name.trim(),
      latitude: selectedLocation.lat,
      longitude: selectedLocation.lng,
      nearbyLandmarks: form.nearbyLandmarks.trim(),
      rating: Number(form.rating),
      imageUrls: [],
      details: form.details.trim(),
      localOnly: true,
    }
    setLocalPins((current) => [optimisticPin, ...current])
    setSelectedLocation(null)

    if (!hasFirebaseConfig) {
      setNotice('Pin saved locally only. Add Firebase credentials to sync online.')
      setSaving(false)
      return
    }

    try {
      const pinRef = doc(collection(db, 'loos'))
      await setDoc(pinRef, {
        ...optimisticPin,
        id: pinRef.id,
        localOnly: false,
        createdAt: serverTimestamp(),
      })

      let imageUrls = []
      if (form.images.length) {
        imageUrls = await uploadImages(form.images, pinRef.id)
        await updateDoc(pinRef, { imageUrls })
      }

      setLocalPins((current) =>
        current.filter((pin) => pin.id !== tempId),
      )
      setNotice('Pin saved to Firebase.')
    } catch {
      setNotice('Pin saved locally only (Firebase write blocked).')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <h1>Loo Locator</h1>
          <p>Click map to pin, then fill the popup form.</p>
        </div>
        <div className="top-bar-actions">
          <select value={filterRating} onChange={(event) => setFilterRating(event.target.value)}>
            <option value="all">All ratings</option>
            <option value="5">5 stars only</option>
            <option value="4">4 stars and up</option>
            <option value="3">3 stars and up</option>
            <option value="2">2 stars and up</option>
            <option value="1">1 star and up</option>
          </select>
          <button type="button" onClick={locateMe} disabled={isLocating}>
            {isLocating ? 'Locating...' : 'Locate Me'}
          </button>
          <button type="button" className="secondary" onClick={() => openPinForm({ lat: visibleCenter[0], lng: visibleCenter[1] })}>
            Pin At Center
          </button>
        </div>
      </header>

      {error ? <p className="status error">{error}</p> : null}
      {notice ? <p className="status warning">{notice}</p> : null}
      {loadingPins ? <p className="status">Loading pins...</p> : null}

      <MapContainer center={mapCenter} zoom={14} className="map" tap={false}>
        <LocateMap center={mapCenter} />
        <MapEvents onMapClick={openPinForm} onCenterChange={setVisibleCenter} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
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
                {pin.localOnly ? <small className="hint">Local only</small> : null}
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
          <Popup
            position={[selectedLocation.lat, selectedLocation.lng]}
            closeOnClick={false}
            autoClose={false}
            autoPan={false}
            closeOnEscapeKey
            maxWidth={320}
          >
            <form className="popup-form" onSubmit={savePin} onClick={(event) => event.stopPropagation()}>
              <h3>Add New Loo</h3>
              <p className="coordinates">
                {selectedLocation.lat.toFixed(5)}, {selectedLocation.lng.toFixed(5)}
              </p>

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
                  min="0"
                  max="5"
                  value={form.rating}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, rating: Number(event.target.value) }))
                  }
                  required
                />
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
                <button
                  type="button"
                  className="secondary"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelectedLocation(null)
                  }}
                >
                  Cancel
                </button>
                <button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : 'Save To Map'}
                </button>
              </div>
            </form>
          </Popup>
        ) : null}
      </MapContainer>
    </main>
  )
}

export default App
