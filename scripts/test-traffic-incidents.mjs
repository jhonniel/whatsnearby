import { readFileSync } from 'node:fs'
import { TomTomConfig } from '@tomtom-org/maps-sdk/core'
import { trafficIncidentDetails } from '@tomtom-org/maps-sdk/services'

function loadEnvKey() {
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    const line = raw.split('\n').find((l) => l.startsWith('VITE_TOMTOM_API_KEY='))
    return line?.slice('VITE_TOMTOM_API_KEY='.length).trim() || ''
  } catch {
    return process.env.VITE_TOMTOM_API_KEY || ''
  }
}

const apiKey = loadEnvKey()
if (!apiKey) {
  console.error('No VITE_TOMTOM_API_KEY in .env')
  process.exit(1)
}

TomTomConfig.instance.put({ apiKey })

// Amsterdam — usually has traffic incidents
const bbox = [4.85, 52.34, 4.95, 52.4]

try {
  const result = await trafficIncidentDetails({
    bbox,
    timeValidityFilter: ['present'],
  })
  const count = result?.features?.length ?? 0
  console.log('OK: incident features in bbox:', count)
  if (count > 0) {
    const f = result.features[0]
    console.log('Sample:', f.properties?.iconCategory, f.geometry?.type)
  }
} catch (err) {
  console.error('API error:', err.message || err)
  if (err.issues) console.error('Issues:', JSON.stringify(err.issues, null, 2))
  process.exit(1)
}
