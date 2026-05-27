const COLLECTION_EMOJI = {
  loos: '🚽',
  restaurants_cafes: '🍽️',
  tambayan_24h: '🌙',
}

export function pinEmojiForCollection(collection) {
  return COLLECTION_EMOJI[collection] || '📍'
}

export function buildCommunityPinElement(pin, { labelCategoryKey, showLabel = true }) {
  const wrap = document.createElement('div')
  wrap.className = 'tomtom-pin-marker'
  wrap.setAttribute('role', 'img')
  wrap.setAttribute('aria-label', pin.name || 'Map pin')

  if (showLabel) {
    const label = document.createElement('span')
    label.className = `pin-name-label pin-name-label--${labelCategoryKey}`
    label.textContent = pin.name || 'Unnamed place'
    wrap.appendChild(label)
  }

  const icon = document.createElement('span')
  icon.className = 'toilet-marker'
  icon.textContent = pinEmojiForCollection(pin.collection)
  wrap.appendChild(icon)

  return wrap
}

export function buildCsvPreviewPinElement(pin) {
  const wrap = document.createElement('div')
  wrap.className = 'tomtom-csv-preview-marker'
  const label = document.createElement('span')
  label.className = 'tomtom-csv-preview-label'
  label.textContent = pin.name || 'Preview'
  const suffix = document.createElement('span')
  suffix.className = 'csv-preview-tooltip-suffix'
  suffix.textContent = ' (preview)'
  label.appendChild(suffix)
  const dot = document.createElement('span')
  dot.className = 'csv-preview-marker-dot'
  dot.setAttribute('aria-hidden', 'true')
  wrap.append(label, dot)
  return wrap
}

export function buildUserLocationElement() {
  const img = document.createElement('img')
  img.src = '/user-location-pin.png'
  img.alt = 'You are here'
  img.className = 'tomtom-user-pin-img'
  img.width = 52
  img.height = 52
  return img
}

export function buildDraftPinElement(collection, fallbackEmoji = '📍') {
  const wrap = document.createElement('div')
  wrap.className = 'tomtom-pin-marker'
  const icon = document.createElement('span')
  icon.className = 'toilet-marker'
  icon.textContent = pinEmojiForCollection(collection) || fallbackEmoji
  wrap.appendChild(icon)
  return wrap
}
