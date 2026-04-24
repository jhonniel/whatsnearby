/**
 * Seeds Firestore `admins/{uid}` so that user can verify/delete pins (see firestore.rules).
 *
 * Credentials (pick one):
 *   A) Service account JSON — recommended for local runs.
 *   B) Application Default Credentials — e.g. after `gcloud auth application-default login`
 *      with `VITE_FIREBASE_PROJECT_ID` (or FIREBASE_PROJECT_ID) in `.env`.
 *
 * Usage (from repo root):
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/key.json npm run seed:admin -- --email=admin@example.com
 *   GOOGLE_APPLICATION_CREDENTIALS=./path/to/key.json npm run seed:admin -- --uid=AUTH_UID
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
} from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '..')

function loadEnvFiles() {
  for (const name of ['.env', '.env.local']) {
    const p = join(repoRoot, name)
    if (!existsSync(p)) continue
    const text = readFileSync(p, 'utf8')
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t || t.startsWith('#')) continue
      const i = t.indexOf('=')
      if (i === -1) continue
      const key = t.slice(0, i).trim()
      let val = t.slice(i + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (process.env[key] === undefined) process.env[key] = val
    }
  }
}

/** Strip invisible / line-separator chars that break copy-paste from chat or PDFs. */
function sanitizeEmail(raw) {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '')
    .trim()
    .toLowerCase()
}

function parseArgs(argv) {
  let uid = (process.env.ADMIN_UID || '').replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').trim()
  let email = process.env.ADMIN_EMAIL ? sanitizeEmail(process.env.ADMIN_EMAIL) : ''
  for (const arg of argv) {
    if (arg.startsWith('--uid=')) uid = arg.slice(6).replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, '').trim()
    else if (arg.startsWith('--email=')) email = sanitizeEmail(arg.slice(8))
  }
  return { uid, email }
}

/**
 * @returns {object | null} Parsed service account, or null if none found (ADC may still work).
 */
function resolveServiceAccountJson() {
  const explicit =
    process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  if (explicit) {
    if (!existsSync(explicit)) {
      console.error(
        `Service account file not found at:\n  ${explicit}\n\nFix the path, or remove GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT_PATH to try other options.`,
      )
      process.exit(1)
    }
    return JSON.parse(readFileSync(explicit, 'utf8'))
  }
  const fallback = join(repoRoot, 'serviceAccount.json')
  if (existsSync(fallback)) {
    return JSON.parse(readFileSync(fallback, 'utf8'))
  }
  return null
}

/**
 * When using a service account JSON, its project_id must match initializeApp —
 * otherwise Auth/Firestore calls hit the wrong project and you get errors like
 * "There is no configuration corresponding to the provided identifier."
 */
function projectIdForInit(serviceAccount) {
  const fromKey = serviceAccount?.project_id?.trim() || ''
  const fromEnv =
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
    ''

  if (fromKey && fromEnv && fromKey !== fromEnv) {
    console.warn(
      `Warning: .env project id (${fromEnv}) differs from service account (${fromKey}). Using the service account project.`,
    )
  }

  if (fromKey) return fromKey
  return fromEnv
}

function printCredentialHelp() {
  console.error(`
No usable credentials for Firebase Admin.

Option A — Service account JSON (recommended)
  1. Firebase Console → Project settings (gear) → Service accounts
  2. "Generate new private key" → save the JSON file (do not commit it)
  3. From the repo root, run:

     GOOGLE_APPLICATION_CREDENTIALS=/full/path/to/your-key.json npm run seed:admin -- --email=YOUR_AUTH_EMAIL

     Or copy the file to ./serviceAccount.json (gitignored) and run:

     npm run seed:admin -- --email=YOUR_AUTH_EMAIL

Option B — Application Default Credentials
  - Install Google Cloud SDK, then: gcloud auth application-default login
  - Put your Firebase project id in .env as VITE_FIREBASE_PROJECT_ID (or set FIREBASE_PROJECT_ID)
  - Run: npm run seed:admin -- --email=YOUR_AUTH_EMAIL

Docs: https://firebase.google.com/docs/admin/setup
`)
}

async function main() {
  loadEnvFiles()
  const { uid: uidArg, email } = parseArgs(process.argv.slice(2))

  if (!uidArg && !email) {
    console.error('Provide --uid=<Firebase Auth UID> or --email=user@example.com (or ADMIN_UID / ADMIN_EMAIL).')
    process.exit(1)
  }

  const serviceAccount = resolveServiceAccountJson()
  const projectId = projectIdForInit(serviceAccount)

  if (!projectId) {
    console.error(
      'Could not determine Firebase project ID. Add VITE_FIREBASE_PROJECT_ID to .env, or use a service account JSON (it contains project_id).',
    )
    process.exit(1)
  }

  if (!getApps().length) {
    if (serviceAccount) {
      initializeApp({
        credential: cert(serviceAccount),
        projectId,
      })
    } else {
      try {
        initializeApp({
          credential: applicationDefault(),
          projectId,
        })
        console.log('(Using Application Default Credentials — no service account JSON loaded.)\n')
      } catch {
        printCredentialHelp()
        process.exit(1)
      }
    }
  }

  const auth = getAuth()
  const db = getFirestore()

  let uid = uidArg
  if (!uid && email) {
    const user = await auth.getUserByEmail(email)
    uid = user.uid
    console.log(`Resolved email ${email} → uid ${uid}`)
  }

  const ref = db.collection('admins').doc(uid)
  await ref.set(
    {
      role: 'admin',
      seededAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  console.log(`Wrote admins/${uid} in project ${projectId}. That user can log in with the normal app Login.`)
}

main().catch((err) => {
  const code = err?.errorInfo?.code || err?.code
  console.error(err.message || err)
  if (code === 'auth/configuration-not-found' || /configuration corresponding/i.test(String(err.message))) {
    console.error(`
This usually means the Admin SDK project does not match your Firebase app, or Auth is not enabled.
- Use a service account JSON from the same Firebase project as your web app (.env).
- The seeder now prefers project_id from that JSON over VITE_FIREBASE_PROJECT_ID.
- In Firebase Console: Authentication → Sign-in method → enable Email/Password if needed.
`)
  }
  if (code === 'auth/user-not-found') {
    console.error('No Auth user with that email in this project. Create the user in Console → Authentication first.')
  }
  process.exit(1)
})
