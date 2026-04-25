import { useEffect, useMemo, useRef, useState } from 'react'
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet'
import {
  Accessibility,
  ArrowRight,
  Check,
  ChevronRight,
  Cloud,
  Droplets,
  LayoutGrid,
  Map,
  MapPinned,
  Moon,
  Navigation,
  Radio,
  Shield,
  ShieldCheck,
  Sun,
  Smartphone,
  Sparkles,
  UtensilsCrossed,
  UsersRound,
  Zap,
} from 'lucide-react'
import './LandingPage.css'
import { db, hasFirebaseConfig } from './firebase'

/** Firestore collections used by live maps (same as App MAP_REGISTRY). */
const PREVIEW_PIN_COLLECTIONS = ['loos', 'restaurants_cafes', 'tambayan_24h']

/** Only show preview pins within this radius of the visitor (meters). */
const PREVIEW_NEARBY_RADIUS_METERS = 25_000

function previewDistanceMeters(lat1, lon1, lat2, lon2) {
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

const previewToiletIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Toilet">🚽</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const previewRestaurantIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Restaurant or cafe">🍽️</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const previewTambayanIcon = L.divIcon({
  className: 'toilet-marker',
  html: '<span role="img" aria-label="Tambayan spot">🌙</span>',
  iconSize: [28, 28],
  iconAnchor: [14, 28],
  popupAnchor: [0, -28],
})

const previewUserIcon = L.icon({
  iconUrl: '/user-location-pin.png',
  iconSize: [46, 62],
  iconAnchor: [23, 62],
  popupAnchor: [0, -56],
})

function previewIconForCollection(collection) {
  if (collection === 'restaurants_cafes') return previewRestaurantIcon
  if (collection === 'tambayan_24h') return previewTambayanIcon
  return previewToiletIcon
}

const mapCatalog = [
  {
    id: 'community-map',
    title: 'All shared pins',
    category: 'Overview',
    description:
      'One map with every live pin from restrooms, food, and late-night tambayan—browse what neighbors shared, then open a topic map if you want to add or edit.',
    status: 'available',
  },
  {
    id: 'loo-finder',
    title: 'Loo Finder',
    category: 'Sanitation',
    description:
      'Neighbors share public restrooms nearby—ratings, landmarks, and directions so everyone can find a clean stop when they need one.',
    status: 'available',
  },
  {
    id: 'restaurants-cafe',
    title: 'Restaurants & Cafe',
    category: 'Food & drink',
    description:
      'A shared map for eats and coffee around you; same simple pins and directions as the rest of the project—built by people who live here.',
    status: 'available',
  },
  {
    id: 'tambayan-24hrs',
    title: 'Tambayan 24hrs',
    category: 'Night & hangouts',
    description:
      'Late-night spots that stay open—shared by the community so night-shift workers and friends always have somewhere to gather.',
    status: 'available',
  },
  {
    id: 'water-refill',
    title: 'Water Refill',
    category: 'Utilities',
    description: 'A future layer for refill stations—volunteers will map safe drinking water when this map opens.',
    status: 'coming-soon',
  },
  {
    id: 'accessibility',
    title: 'Accessibility',
    category: 'Mobility',
    description: 'Ramps, elevators, and easier routes—on the list for neighbors who use wheels or need step-free access.',
    status: 'coming-soon',
  },
]

/** Maps section + hero CTA rotation (overview `community-map` still opens from “Open maps” in nav/CTA). */
const mapCatalogForList = mapCatalog.filter((item) => item.id !== 'community-map')

/** Replace hrefs when official community pages go live. */
const FOOTER_SOCIAL_LINKS = [
  { network: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/' },
  { network: 'instagram', label: 'Instagram', href: 'https://www.instagram.com/' },
  { network: 'x', label: 'X', href: 'https://x.com/' },
]

/** Recognizable brand marks (single-color via currentColor). */
function FooterSocialBrandIcon({ network }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', 'aria-hidden': true }
  switch (network) {
    case 'facebook':
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
          />
        </svg>
      )
    case 'instagram':
      return (
        <svg {...common} fill="none">
          <rect x="2" y="2" width="20" height="20" rx="5" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="4.25" stroke="currentColor" strokeWidth="2" />
          <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" />
        </svg>
      )
    case 'x':
      return (
        <svg {...common}>
          <path
            fill="currentColor"
            d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
          />
        </svg>
      )
    default:
      return null
  }
}

const landingStats = [
  { label: 'Places neighbors shared', value: '1,250+' },
  { label: 'People pitching in', value: '320+' },
  { label: 'Routes helped / mo', value: '9,800+' },
  { label: 'Areas on the map', value: '18' },
]

const processSteps = [
  {
    title: 'Choose a map',
    text: 'Pick the topic that fits your day—restrooms, food, or late-night tambayan—and see what others mapped near you.',
    Icon: LayoutGrid,
  },
  {
    title: 'Share or browse',
    text: 'Drop a pin with what you know, or read what neighbors already posted—landmarks, prices, and honest ratings.',
    Icon: MapPinned,
  },
  {
    title: 'Get there together',
    text: 'Open directions from where you are to the spot someone trusted enough to share.',
    Icon: Navigation,
  },
]

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3
}

function parseStatDisplay(value) {
  const t = String(value).trim()
  if (t === '—') return { kind: 'raw', raw: t }
  const m = t.match(/^([\d,]+)(.*)$/)
  if (!m) return { kind: 'raw', raw: t }
  const target = Number.parseInt(m[1].replace(/,/g, ''), 10)
  if (!Number.isFinite(target)) return { kind: 'raw', raw: t }
  return { kind: 'count', target, suffix: m[2] || '' }
}

function CountUpStat({ value, delayMs = 0, duration = 1500 }) {
  const parsed = useMemo(() => parseStatDisplay(value), [value])
  const [n, setN] = useState(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (parsed.kind !== 'count') return undefined

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    if (reduced) {
      const id = requestAnimationFrame(() => setN(parsed.target))
      return () => cancelAnimationFrame(id)
    }

    let startTs = null
    const tick = (ts) => {
      if (startTs === null) startTs = ts
      const elapsed = ts - startTs
      const p = Math.min(1, elapsed / duration)
      setN(Math.round(easeOutCubic(p) * parsed.target))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }

    const timeoutId = window.setTimeout(() => {
      rafRef.current = requestAnimationFrame(tick)
    }, delayMs)

    return () => {
      window.clearTimeout(timeoutId)
      cancelAnimationFrame(rafRef.current)
    }
  }, [parsed, delayMs, duration])

  if (parsed.kind === 'raw') {
    return <>{parsed.raw}</>
  }

  return (
    <>
      {n.toLocaleString()}
      {parsed.suffix}
    </>
  )
}

const HERO_CTA_ROTATE_MS = 3400

function HeroRotatingMapCta({ maps, onOpenMap }) {
  const [index, setIndex] = useState(0)
  const pausedRef = useRef(false)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduceMotion(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    const frame = requestAnimationFrame(() => setIndex(0))
    return () => cancelAnimationFrame(frame)
  }, [maps.length])

  useEffect(() => {
    if (maps.length <= 1 || reduceMotion) return undefined
    const id = window.setInterval(() => {
      if (pausedRef.current) return
      setIndex((i) => (i + 1) % maps.length)
    }, HERO_CTA_ROTATE_MS)
    return () => window.clearInterval(id)
  }, [maps.length, reduceMotion])

  const current = maps[index] ?? maps[0]
  if (!current) {
    return (
      <button type="button" className="saas-btn saas-btn--primary" onClick={() => onOpenMap('community-map')}>
        Open the maps
        <ArrowRight size={16} strokeWidth={2} aria-hidden />
      </button>
    )
  }

  const pause = () => {
    pausedRef.current = true
  }
  const resume = () => {
    pausedRef.current = false
  }

  return (
    <button
      type="button"
      className="saas-btn saas-btn--primary saas-hero-cta-rotating"
      onClick={() => onOpenMap(current.id)}
      aria-label={`Open ${current.title} map`}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <span className="saas-hero-cta-label">
        Open{' '}
        <span className="saas-hero-cta-mapname" aria-live="polite">
          {current.title}
        </span>
      </span>
      <ArrowRight size={16} strokeWidth={2} aria-hidden />
    </button>
  )
}

const faqs = [
  {
    q: 'What is whatsnearby for?',
    a: 'Helping our community easily find the pins they need—restrooms, food, late-night tambayan, and more as neighbors add them. Open a map near you, browse what others shared, or add a pin when you learn something useful.',
  },
  {
    q: 'Who runs this?',
    a: 'Volunteers and neighbors who live here. Map pins are community-sourced, and trusted locals can help verify listings so the right spots are easier to spot on the map.',
  },
  {
    q: 'Where does map data come from?',
    a: 'From people like you. Pins are stored so the community can see updates in near real time; base maps use OpenStreetMap. Directions use a public routing demo—always double-check important trips.',
  },
  {
    q: 'Can I use it on my phone?',
    a: 'Yes. The layout is meant for phones first—large tap targets, readable type, and optional dark mode for night use.',
  },
  {
    q: 'What maps are available today?',
    a: 'Loo Finder, Restaurants & Cafe, and Tambayan 24hrs are live today. Water refill and accessibility are ideas the community may add next—open a card to see what is coming.',
  },
]

function InvalidatePreviewSize() {
  const map = useMap()
  useEffect(() => {
    const fix = () => map.invalidateSize()
    fix()
    const id = requestAnimationFrame(fix)
    const t = window.setTimeout(fix, 120)
    const t2 = window.setTimeout(fix, 400)
    window.addEventListener('resize', fix)
    return () => {
      cancelAnimationFrame(id)
      window.clearTimeout(t)
      window.clearTimeout(t2)
      window.removeEventListener('resize', fix)
    }
  }, [map])
  return null
}

function PreviewFollowUser({ center, zoom = 13 }) {
  const map = useMap()
  const lat = center[0]
  const lng = center[1]

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      map.setView([lat, lng], zoom)
    })
    return () => cancelAnimationFrame(id)
  }, [map, lat, lng, zoom])

  return null
}

function useLandingPreviewPins(userLocation) {
  const [pinsByCollection, setPinsByCollection] = useState(() =>
    Object.fromEntries(PREVIEW_PIN_COLLECTIONS.map((c) => [c, []])),
  )

  useEffect(() => {
    if (!hasFirebaseConfig || !db) return undefined

    const unsubs = PREVIEW_PIN_COLLECTIONS.map((collName) => {
      const q = query(collection(db, collName), orderBy('createdAt', 'desc'))
      return onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({
            id: d.id,
            collection: collName,
            ...d.data(),
          }))
          setPinsByCollection((prev) => ({ ...prev, [collName]: list }))
        },
        () => {
          setPinsByCollection((prev) => ({ ...prev, [collName]: [] }))
        },
      )
    })

    return () => {
      unsubs.forEach((u) => u())
    }
  }, [])

  return useMemo(() => {
    const emptyByMapId = {
      'community-map': [],
      'loo-finder': [],
      'restaurants-cafe': [],
      'tambayan-24hrs': [],
    }

    if (
      !userLocation ||
      userLocation.length < 2 ||
      !Number.isFinite(userLocation[0]) ||
      !Number.isFinite(userLocation[1])
    ) {
      return { allNearby: [], byMapId: emptyByMapId }
    }

    const [lat, lng] = userLocation

    const nearbyInCollection = (collName) => {
      const raw = pinsByCollection[collName] ?? []
      return raw.filter(
        (p) =>
          typeof p.latitude === 'number' &&
          typeof p.longitude === 'number' &&
          Number.isFinite(p.latitude) &&
          Number.isFinite(p.longitude) &&
          previewDistanceMeters(lat, lng, p.latitude, p.longitude) <= PREVIEW_NEARBY_RADIUS_METERS,
      )
    }

    const loos = nearbyInCollection('loos')
    const restaurants = nearbyInCollection('restaurants_cafes')
    const tambayan = nearbyInCollection('tambayan_24h')
    const combinedNearby = [...loos, ...restaurants, ...tambayan]

    return {
      allNearby: combinedNearby,
      byMapId: {
        'community-map': combinedNearby,
        'loo-finder': loos,
        'restaurants-cafe': restaurants,
        'tambayan-24hrs': tambayan,
      },
    }
  }, [pinsByCollection, userLocation])
}

function LandingMapPreview({ location, theme, pins = [] }) {
  if (!location) {
    return (
      <div className="saas-map-preview-fallback">
        Enable location to see community pins near you on the map (within about{' '}
        {Math.round(PREVIEW_NEARBY_RADIUS_METERS / 1000)} km).
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
      <InvalidatePreviewSize />
      <PreviewFollowUser center={location} zoom={13} />
      <TileLayer
        url={
          theme === 'dark'
            ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
        }
      />
      {pins.map((pin) => (
        <Marker
          key={`${pin.collection}-${pin.id}`}
          position={[pin.latitude, pin.longitude]}
          icon={previewIconForCollection(pin.collection)}
        >
          <Tooltip sticky direction="top" opacity={0.92}>
            {pin.name?.trim() || 'Community pin'}
          </Tooltip>
        </Marker>
      ))}
      {location ? (
        <Marker position={location} icon={previewUserIcon}>
          <Tooltip sticky direction="top" opacity={0.92}>
            Your location
          </Tooltip>
        </Marker>
      ) : null}
    </MapContainer>
  )
}

export function LandingPage({ theme, setTheme, userLocation, onOpenMap }) {
  const dark = theme === 'dark'
  const availableMaps = useMemo(
    () => mapCatalogForList.filter((m) => m.status === 'available'),
    [],
  )
  const landingPreviewPins = useLandingPreviewPins(userLocation)

  return (
    <div className={`saas-shell ${dark ? 'saas-shell--dark' : ''}`}>
      <nav className="saas-nav" aria-label="Primary">
        <div className="saas-nav-brand">
          <img
            className="saas-nav-logo"
            src="/whatsnearby-logo.png"
            alt="whatsnearby"
            width={200}
            height={48}
            decoding="async"
          />
        </div>
        <div className="saas-nav-links">
          <a href="#features">What we do</a>
          <a href="#maps">Maps</a>
          <a href="#workflow">How it works</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="saas-nav-actions">
          <label className="theme-toggle" aria-label="Toggle light or dark mode">
            <input
              type="checkbox"
              checked={dark}
              onChange={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
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
          <button type="button" className="saas-btn saas-btn--primary" onClick={() => onOpenMap('community-map')}>
            Open maps
            <ChevronRight size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </nav>

      <header className="saas-hero">
        <div className="saas-hero-inner">
          <div>
            <p className="saas-eyebrow">
              <Zap size={14} strokeWidth={2} aria-hidden />
              Neighbors helping neighbors
            </p>
            <h1>Shared maps for everyday needs—built by the community, for the community.</h1>
            <p className="saas-hero-lead">
              Help our community easily find the pins they need—restrooms, food, late-night tambayan,
              and more. Volunteers and neighbors map what they know so everyone can spot a trusted place
              nearby and get directions when it matters.
            </p>
            <div className="saas-hero-ctas">
              <HeroRotatingMapCta maps={availableMaps} onOpenMap={onOpenMap} />
              <a href="#features" className="saas-btn saas-btn--ghost" style={{ textDecoration: 'none' }}>
                Learn how we help
              </a>
            </div>
            <div className="saas-hero-proof">
              <span>
                <Check size={14} strokeWidth={2} aria-hidden />
                Find pins neighbors actually use
              </span>
              <span>
                <Check size={14} strokeWidth={2} aria-hidden />
                Open map data and shared local pins
              </span>
              <span>
                <Check size={14} strokeWidth={2} aria-hidden />
                Works on phones and dark mode
              </span>
            </div>
          </div>
          <div className="saas-hero-visual">
            <div className="saas-hero-card">
              <div className="saas-hero-card-cap">
                <span className="saas-dot" />
                <span className="saas-dot" />
                <span className="saas-dot" />
                <span style={{ marginLeft: 'auto', opacity: 0.75 }}>Near you</span>
              </div>
              <div className="saas-map-preview-wrap">
                <LandingMapPreview
                  location={userLocation}
                  theme={theme}
                  pins={landingPreviewPins.allNearby}
                />
              </div>
              <div className="saas-float-badge">
                <Sparkles size={14} strokeWidth={2} aria-hidden />
                Pins neighbors shared nearby
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="saas-stats-band">
        <div className="saas-stats-grid">
          {landingStats.map((s, index) => (
            <div key={s.label} className="saas-stat">
              <strong aria-label={s.value}>
                <CountUpStat value={s.value} delayMs={index * 120} duration={1600} />
              </strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="saas-section" id="features" aria-labelledby="features-heading">
        <div className="saas-section-head">
          <p className="saas-section-kicker">What we do</p>
          <h2 id="features-heading">Practical help, one pin at a time</h2>
          <p>
            We coordinate open maps so people can share what they know—restrooms, food, safe
            hangouts—and get simple directions when it matters. Together we make it easier for everyone
            to find the pin they need.
          </p>
        </div>
        <div className="saas-bento">
          <article className="saas-bento-card saas-bento-tall">
            <div className="saas-icon-wrap" aria-hidden>
              <MapPinned size={22} strokeWidth={1.75} />
            </div>
            <h3>Honest, local knowledge</h3>
            <p>
              Landmarks, prices, and whether a spot has a fee come from people nearby. Volunteer moderators
              can help mark listings that have been double-checked.
            </p>
          </article>
          <article className="saas-bento-card">
            <div className="saas-icon-wrap saas-icon-wrap--blue" aria-hidden>
              <Navigation size={22} strokeWidth={1.75} />
            </div>
            <h3>Directions when you need them</h3>
            <p>
              Turn-by-turn style routing from your current location to a community pin—using public
              map data so you can plan a walk or ride.
            </p>
          </article>
          <article className="saas-bento-card">
            <div className="saas-icon-wrap saas-icon-wrap--violet" aria-hidden>
              <UsersRound size={22} strokeWidth={1.75} />
            </div>
            <h3>Everyone can chip in</h3>
            <p>
              Add a pin when you learn something new; sign in when you need to fix details or move a
              marker. We keep the bar low so more neighbors can help.
            </p>
          </article>
          <article className="saas-bento-card saas-bento-wide">
            <div className="saas-icon-wrap" aria-hidden>
              <Smartphone size={22} strokeWidth={1.75} />
            </div>
            <h3>On the sidewalk, not the boardroom</h3>
            <p>
              Large tap targets, readable maps, and optional dark mode—because most of us check this
              on a phone, in a hurry, under real street conditions.
            </p>
          </article>
        </div>
      </section>

      <section className="saas-section saas-muted-section" id="maps" aria-labelledby="maps-heading">
        <div className="saas-section-head">
          <p className="saas-section-kicker">Maps</p>
          <h2 id="maps-heading">Different topics, same spirit of sharing</h2>
          <p>
            Each map is a volunteer-led layer—sanitation, food and drink, and late-night tambayan are
            live today. More ideas may follow as neighbors step up to help.
          </p>
        </div>
        <div className="saas-maps-grid">
          {mapCatalogForList.map((item) => (
            <article
              key={item.id}
              className={`saas-map-card ${item.status !== 'available' ? 'disabled' : ''}`}
            >
              <div className="saas-map-card-head">
                <span className="saas-map-card-icon" aria-hidden>
                  {item.id === 'loo-finder' ? (
                    <Map size={20} strokeWidth={1.75} />
                  ) : item.id === 'restaurants-cafe' ? (
                    <UtensilsCrossed size={20} strokeWidth={1.75} />
                  ) : item.id === 'tambayan-24hrs' ? (
                    <Moon size={20} strokeWidth={1.75} />
                  ) : item.id === 'water-refill' ? (
                    <Droplets size={20} strokeWidth={1.75} />
                  ) : (
                    <Accessibility size={20} strokeWidth={1.75} />
                  )}
                </span>
                <span className="saas-chip">{item.category}</span>
              </div>
              {item.status === 'available' ? (
                <div className="saas-map-preview">
                  <div className="saas-map-preview-wrap">
                    <LandingMapPreview
                      location={userLocation}
                      theme={theme}
                      pins={landingPreviewPins.byMapId[item.id] ?? []}
                    />
                  </div>
                </div>
              ) : null}
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              {item.status === 'available' ? (
                <button type="button" className="saas-btn saas-btn--primary" onClick={() => onOpenMap(item.id)}>
                  Open map
                </button>
              ) : (
                <button type="button" className="saas-btn saas-btn--ghost" disabled>
                  Coming soon
                </button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="saas-section" id="workflow" aria-labelledby="workflow-heading">
        <div className="saas-section-head">
          <p className="saas-section-kicker">How it works</p>
          <h2 id="workflow-heading">Three simple steps—no training manual</h2>
          <p>
            If you have used maps on your phone, you already know enough to help—or to find what you
            need.
          </p>
        </div>
        <div className="saas-steps">
          {processSteps.map((step, index) => {
            const StepIcon = step.Icon
            return (
              <article key={step.title} className="saas-step">
                <div className="saas-step-num">Step {index + 1}</div>
                <div className="saas-icon-wrap" style={{ marginBottom: '0.65rem' }} aria-hidden>
                  <StepIcon size={20} strokeWidth={1.75} />
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            )
          })}
        </div>
      </section>

      <section className="saas-section" aria-labelledby="quote-heading">
        <h2 id="quote-heading" className="visually-hidden">
          Community voice
        </h2>
        <figure className="saas-quote">
          <blockquote>
            “Clear maps and honest pins—when you are in a rush, it is easier to find what you need
            because someone nearby already shared it.”
          </blockquote>
          <figcaption>— Early volunteers and testers</figcaption>
        </figure>
      </section>

      <section className="saas-section" id="faq" aria-labelledby="faq-heading">
        <div className="saas-section-head">
          <p className="saas-section-kicker">FAQ</p>
          <h2 id="faq-heading">Questions, answered</h2>
          <p>Still curious? Open a map anytime and see how neighbors are making it easier to find the right pin.</p>
        </div>
        <div className="saas-faq-list">
          {faqs.map((item) => (
            <details key={item.q} className="saas-faq-item">
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="saas-cta-band" aria-labelledby="cta-heading">
        <div className="saas-cta-inner">
          <h2 id="cta-heading">Need something nearby—or want to help?</h2>
          <p>
            Allow location once to see pins neighbors shared around you, or jump in and add what you
            know so the next person finds the right spot faster.
          </p>
          <button type="button" className="saas-btn saas-btn--primary" onClick={() => onOpenMap('community-map')}>
            Open the maps
            <ArrowRight size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
      </section>

      <footer className="saas-footer">
        <div className="saas-footer-inner">
          <div className="saas-footer-top">
            <div className="saas-footer-brand">
              <img
                className="saas-footer-logo"
                src="/whatsnearby-logo.png"
                alt=""
                width={180}
                height={44}
                decoding="async"
              />
              <strong className="visually-hidden">whatsnearby</strong>
              <p>
                A volunteer-led community effort—shared maps for restrooms, food, late-night tambayan,
                and whatever neighbors decide to help with next, so everyone can find the pin they need.
              </p>
            </div>
            <section className="saas-footer-social" aria-labelledby="footer-social-heading">
              <h3 id="footer-social-heading" className="saas-footer-social-heading">
                Social
              </h3>
              <p className="saas-footer-social-lead">Updates and stories from neighbors building the maps.</p>
              <ul className="saas-footer-social-list">
                {FOOTER_SOCIAL_LINKS.map(({ network, label, href }) => (
                  <li key={label}>
                    <a
                      className="saas-footer-social-link"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="saas-footer-social-icon">
                        <FooterSocialBrandIcon network={network} />
                      </span>
                      <span>{label}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <ul className="saas-footer-meta" aria-label="Project highlights">
            <li className="saas-footer-pill">
              <Radio size={13} strokeWidth={2} aria-hidden />
              People-powered
            </li>
            <li className="saas-footer-pill">
              <Cloud size={13} strokeWidth={2} aria-hidden />
              Open map data
            </li>
            <li className="saas-footer-pill">
              <Shield size={13} strokeWidth={2} aria-hidden />
              Volunteer moderators
            </li>
            <li className="saas-footer-pill">
              <ShieldCheck size={13} strokeWidth={2} aria-hidden />
              Easier local discovery
            </li>
          </ul>
          <div className="saas-footer-bottom">
            <small className="saas-footer-copy">
              © {new Date().getFullYear()} whatsnearby — community maps for everyday needs.
            </small>
          </div>
        </div>
      </footer>
    </div>
  )
}
