import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { X } from 'lucide-react'
import {
  buildImportDetails,
  buildRatingSum,
  nominatimSearchOne,
  parseRestaurantCsv,
} from './csvRestaurantImport'

const GEOCODE_GAP_MS = 1100
const MAX_ROWS = 60

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms)
    }),
  ])
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function CsvRestaurantImportPanel({
  open,
  onClose,
  theme,
  db,
  hasFirebaseConfig,
  currentUser,
  onCsvPreviewChange,
  onImported,
  onError,
}) {
  const [rawText, setRawText] = useState('')
  const [rows, setRows] = useState([])
  const [parseInfo, setParseInfo] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSummary, setImportSummary] = useState('')
  const abortRef = useRef(null)
  const geocodeLockRef = useRef(false)

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  const runParse = useCallback(() => {
    setImportSummary('')
    onCsvPreviewChange?.([])
    const { header, rows: parsed } = parseRestaurantCsv(rawText)
    if (!parsed.length) {
      setRows([])
      setParseInfo('No data rows found. Use columns: name, address, rating, reviews, category, phone (CSV with optional header).')
      return
    }
    if (parsed.length > MAX_ROWS) {
      setParseInfo(`Only the first ${MAX_ROWS} rows are loaded (limit).`)
      setRows(
        parsed.slice(0, MAX_ROWS).map((r, i) => ({
          key: `csv-${i}-${r.name}`,
          ...r,
          latitude: null,
          longitude: null,
          status: 'pending',
          matchLabel: '',
          include: true,
        })),
      )
      return
    }
    setParseInfo(
      `Parsed ${parsed.length} row(s)${header ? ' (header skipped)' : ''}. Tap “Geocode addresses” — teal pins show on the map before you save.`,
    )
    setRows(
      parsed.map((r, i) => ({
        key: `csv-${i}-${r.name}`,
        ...r,
        latitude: null,
        longitude: null,
        status: 'pending',
        matchLabel: '',
        include: true,
      })),
    )
  }, [rawText, onCsvPreviewChange])

  const geocodeAll = useCallback(async () => {
    if (!rows.length || geocodeLockRef.current) return
    if (abortRef.current) abortRef.current.abort()
    const ac = new AbortController()
    abortRef.current = ac
    geocodeLockRef.current = true
    setGeocoding(true)
    setImportSummary('')
    onCsvPreviewChange?.([])
    const snapshot = rows
    const previewAccum = []
    try {
      for (let i = 0; i < snapshot.length; i += 1) {
        if (ac.signal.aborted) break
        const row = snapshot[i]
        setRows((prev) =>
          prev.map((r, j) => (j === i ? { ...r, status: 'loading' } : r)),
        )
        const query = `${row.name}, ${row.address}, Philippines`
        try {
          const hit = await withTimeout(
            nominatimSearchOne(query, ac.signal),
            14000,
            'Geocode timed out.',
          )
          if (ac.signal.aborted) break
          if (hit) {
            previewAccum.push({
              id: `csv-preview-${row.key}`,
              name: row.name,
              latitude: hit.latitude,
              longitude: hit.longitude,
            })
            onCsvPreviewChange?.([...previewAccum])
            setRows((prev) =>
              prev.map((r, j) =>
                j === i
                  ? {
                      ...r,
                      latitude: hit.latitude,
                      longitude: hit.longitude,
                      status: 'ok',
                      matchLabel: hit.displayName.slice(0, 120),
                    }
                  : r,
              ),
            )
          } else {
            setRows((prev) =>
              prev.map((r, j) =>
                j === i ? { ...r, latitude: null, longitude: null, status: 'fail', matchLabel: 'No match' } : r,
              ),
            )
          }
        } catch {
          if (ac.signal.aborted) break
          setRows((prev) =>
            prev.map((r, j) =>
              j === i ? { ...r, latitude: null, longitude: null, status: 'fail', matchLabel: 'Error' } : r,
            ),
          )
        }
        if (i < snapshot.length - 1) await sleep(GEOCODE_GAP_MS)
      }
    } finally {
      geocodeLockRef.current = false
      setGeocoding(false)
      abortRef.current = null
      if (!ac.signal.aborted) {
        onCsvPreviewChange?.(previewAccum)
      }
    }
  }, [rows, onCsvPreviewChange])

  const importChecked = useCallback(async () => {
    if (!hasFirebaseConfig || !db) {
      onError?.('Configure Firebase to save pins online.')
      return
    }
    const targets = rows.filter((r) => r.include && r.status === 'ok' && r.latitude != null && r.longitude != null)
    if (!targets.length) {
      onError?.('Geocode at least one row successfully, then try again.')
      return
    }
    setImporting(true)
    setImportSummary('')
    let saved = 0
    let failed = 0
    const committedPins = []
    try {
      for (const row of targets) {
        try {
          const pinRef = doc(collection(db, 'restaurants_cafes'))
          const { rating, ratingCount, ratingSum } = buildRatingSum(row.rating, row.reviews)
          const details = buildImportDetails({ category: row.category, phone: row.phone })
          await withTimeout(
            setDoc(pinRef, {
              id: pinRef.id,
              name: row.name.slice(0, 120),
              latitude: row.latitude,
              longitude: row.longitude,
              nearbyLandmarks: row.address.slice(0, 220),
              rating,
              ratingCount,
              ratingSum,
              price: 0,
              isFree: true,
              details,
              imageUrls: [],
              verified: false,
              createdAt: serverTimestamp(),
              ...(currentUser ? { ownerUid: currentUser.uid } : {}),
            }),
            15000,
            'Firestore save timed out.',
          )
          committedPins.push({
            id: pinRef.id,
            name: row.name.slice(0, 120),
            latitude: row.latitude,
            longitude: row.longitude,
            nearbyLandmarks: row.address.slice(0, 220),
            rating,
            ratingCount,
            ratingSum,
            price: 0,
            isFree: true,
            details,
            imageUrls: [],
            collection: 'restaurants_cafes',
            localOnly: false,
          })
          saved += 1
        } catch {
          failed += 1
        }
      }
      onImported?.({ saved, failed, pins: committedPins })
      if (saved > 0) onClose()
      else setImportSummary(failed ? `All ${failed} save(s) failed. Check Firestore rules.` : 'Nothing was saved.')
    } finally {
      setImporting(false)
    }
  }, [rows, hasFirebaseConfig, db, currentUser, onImported, onClose, onError])

  const showGeocodedOnMap = useCallback(() => {
    const pins = rows
      .filter((r) => r.status === 'ok' && r.latitude != null && r.longitude != null)
      .map((r) => ({
        id: `csv-preview-${r.key}`,
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
      }))
    if (!pins.length) {
      onError?.('Geocode at least one row first, then pins appear on the map.')
      return
    }
    onCsvPreviewChange?.(pins)
  }, [rows, onCsvPreviewChange, onError])

  const onFile = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setRawText(String(reader.result || ''))
      setParseInfo('File loaded — tap “Parse CSV”.')
    }
    reader.readAsText(file)
    event.target.value = ''
  }, [])

  if (!open) return null

  return createPortal(
    <div
      className={['csv-import-backdrop', theme === 'dark' ? 'csv-import-backdrop--dark' : '']
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onClose}
    >
      <div
        className="csv-import-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="csv-import-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="csv-import-panel-header">
          <h2 id="csv-import-title" className="csv-import-panel-title">
            Import restaurants (CSV)
          </h2>
          <button type="button" className="csv-import-close" aria-label="Close" onClick={onClose}>
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>

        <p className="csv-import-lead">
          Paste rows in this order (commas allowed inside quotes):{' '}
          <strong>name, address, rating, reviews, category, phone</strong>. Optional header line starting with{' '}
          <code className="csv-import-code">name,address</code>. Geocoding uses{' '}
          <a href="https://nominatim.org/release-docs/develop/api/Search/" target="_blank" rel="noreferrer">
            OpenStreetMap Nominatim
          </a>{' '}
          (~1 request/sec). Max {MAX_ROWS} rows per batch.
        </p>

        <label className="csv-import-file">
          <span className="csv-import-file-label">Or choose a .csv file</span>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={onFile} />
        </label>

        <textarea
          className="csv-import-textarea"
          rows={10}
          spellCheck={false}
          placeholder={'name,address,rating,reviews,category,phone\n"Ta-Cow Davao","Corner Lapu-Lapu St...",4.8,3213,"Filipino restaurant","+63..."'}
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
        />

        <div className="csv-import-toolbar">
          <button type="button" className="secondary" disabled={!rawText.trim()} onClick={runParse}>
            Parse CSV
          </button>
          <button type="button" className="secondary" disabled={!rows.length || geocoding} onClick={geocodeAll}>
            {geocoding ? 'Geocoding…' : 'Geocode & pin on map'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={geocoding || !rows.some((r) => r.status === 'ok' && r.latitude != null && r.longitude != null)}
            onClick={showGeocodedOnMap}
          >
            Show on map
          </button>
          <button
            type="button"
            disabled={importing || !rows.some((r) => r.include && r.status === 'ok')}
            onClick={importChecked}
          >
            {importing ? 'Saving…' : 'Save geocoded rows'}
          </button>
        </div>

        {parseInfo ? <p className="csv-import-parse-info">{parseInfo}</p> : null}
        {importSummary ? <p className="csv-import-parse-info csv-import-parse-info--warn">{importSummary}</p> : null}

        {rows.length ? (
          <div className="csv-import-table-wrap">
            <table className="csv-import-table">
              <thead>
                <tr>
                  <th className="csv-import-th-check">Use</th>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Rating</th>
                  <th>Reviews</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr key={r.key} className={r.status === 'fail' ? 'is-fail' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={r.include}
                        disabled={r.status !== 'ok'}
                        onChange={() =>
                          setRows((prev) =>
                            prev.map((row, j) => (j === idx ? { ...row, include: !row.include } : row)),
                          )
                        }
                      />
                    </td>
                    <td className="csv-import-td-name">{r.name}</td>
                    <td className="csv-import-td-status">
                      {r.status === 'pending' ? '—' : null}
                      {r.status === 'loading' ? '…' : null}
                      {r.status === 'ok' ? 'OK' : null}
                      {r.status === 'fail' ? 'Fail' : null}
                      {r.matchLabel ? (
                        <span className="csv-import-match" title={r.matchLabel}>
                          {r.matchLabel}
                        </span>
                      ) : null}
                    </td>
                    <td>{Number.isFinite(r.rating) ? r.rating : '—'}</td>
                    <td>{r.reviews}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <footer className="csv-import-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={importing || geocoding}>
            Cancel
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
