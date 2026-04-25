import { createClient } from '@supabase/supabase-js'

function normalizeSupabaseUrl(rawUrl) {
  const value = String(rawUrl || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value)
    const host = parsed.hostname
    // Accept S3-style endpoint and convert to standard Supabase project URL.
    // Example:
    //   uncaz...storage.supabase.co/storage/v1/s3  ->  https://uncaz....supabase.co
    if (host.endsWith('.storage.supabase.co')) {
      const projectRef = host.replace('.storage.supabase.co', '')
      if (projectRef) {
        return `https://${projectRef}.supabase.co`
      }
    }
    // If user pasted a storage API URL from the normal domain, keep only origin.
    if (parsed.pathname.includes('/storage/v1')) {
      return `${parsed.protocol}//${parsed.host}`
    }
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return value
  }
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL)
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const supabaseBucket = import.meta.env.VITE_SUPABASE_BUCKET || 'pin-images'

const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey)

const supabase = hasSupabaseConfig ? createClient(supabaseUrl, supabaseAnonKey) : null

export { hasSupabaseConfig, supabase, supabaseBucket }
