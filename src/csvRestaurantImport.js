/** RFC4180-style CSV line parser (handles quoted fields with commas). */
export function parseCsvLine(line) {
  const fields = []
  let current = ''
  let i = 0
  let inQuotes = false
  while (i < line.length) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      current += c
      i += 1
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (c === ',') {
      fields.push(current)
      current = ''
      i += 1
      continue
    }
    current += c
    i += 1
  }
  fields.push(current)
  return fields.map((s) => s.trim())
}

/** Nominatim policy: identify the application (some browsers ignore this header on fetch). */
const NOMINATIM_UA = 'WhatsNearby/1.0 (restaurant-csv-import)'

/**
 * @param {string} text
 * @returns {{ header: boolean, rows: Array<{ name: string, address: string, rating: number, reviews: number, category: string, phone: string }> }}
 */
export function parseRestaurantCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  if (!lines.length) return { header: false, rows: [] }

  const firstFields = parseCsvLine(lines[0])
  const looksLikeHeader =
    firstFields.length >= 4 &&
    /^name$/i.test(firstFields[0].replace(/^"|"$/g, '')) &&
    /^address$/i.test(firstFields[1].replace(/^"|"$/g, ''))

  const dataLines = looksLikeHeader ? lines.slice(1) : lines
  const rows = []

  for (const line of dataLines) {
    const f = parseCsvLine(line)
    if (f.length < 4) continue
    const name = (f[0] || '').trim()
    const address = (f[1] || '').trim()
    const rating = Number.parseFloat(String(f[2] ?? '').replace(',', '.'))
    const reviews = Number.parseInt(String(f[3] ?? '').replace(/,/g, ''), 10)
    const category = (f[4] || '').trim()
    const phone = (f[5] || '').trim()
    if (name.length < 2) continue
    rows.push({
      name,
      address,
      rating: Number.isFinite(rating) ? rating : 3,
      reviews: Number.isFinite(reviews) && reviews >= 1 ? reviews : 1,
      category,
      phone,
    })
  }

  return { header: looksLikeHeader, rows }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

/**
 * @param {string} query
 * @param {AbortSignal} [signal]
 */
export async function nominatimSearchOne(query, signal) {
  const q = String(query || '').trim()
  if (!q) return null
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': NOMINATIM_UA,
    },
  })
  if (!response.ok) return null
  const list = await response.json().catch(() => [])
  const hit = Array.isArray(list) && list[0] ? list[0] : null
  if (!hit) return null
  const lat = Number(hit.lat)
  const lon = Number(hit.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return {
    latitude: lat,
    longitude: lon,
    displayName: typeof hit.display_name === 'string' ? hit.display_name : '',
  }
}

export function buildRatingSum(rating, reviewCount) {
  const r = clamp(Number(rating) || 3, 1, 5)
  const c = clamp(Math.floor(Number(reviewCount) || 1), 1, 1_000_000)
  let sum = Math.round(r * c)
  sum = clamp(sum, c, 5 * c)
  return { rating: r, ratingCount: c, ratingSum: sum }
}

export function buildImportDetails({ category, phone }) {
  const parts = []
  if (category) parts.push(`Category: ${category}`)
  if (phone) parts.push(`Phone: ${phone}`)
  parts.push('Imported from a CSV paste (address geocoded with OpenStreetMap Nominatim).')
  return parts.join('\n').slice(0, 3000)
}
