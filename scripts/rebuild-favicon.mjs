/**
 * Removes outer white background (flood-fill from image edges) and writes a large
 * transparent PNG to public/favicon.png for tab + apple-touch-icon.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const inputPath = join(root, 'public/favicon.png')
const OUTPUT_SIZE = 512

function isBackground(r, g, b, a) {
  if (a < 8) return true
  // Near-white background; keeps saturated logo colors
  return r > 245 && g > 245 && b > 245
}

function floodTransparentRgba(data, w, h) {
  const visited = new Uint8Array(w * h)
  const queue = []
  const push = (x, y) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return
    const p = y * w + x
    if (visited[p]) return
    const i = p * 4
    if (!isBackground(data[i], data[i + 1], data[i + 2], data[i + 3])) return
    visited[p] = 1
    queue.push(p)
  }

  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }

  while (queue.length) {
    const p = queue.pop()
    const i = p * 4
    data[i + 3] = 0
    const x = p % w
    const y = (p / w) | 0
    push(x + 1, y)
    push(x - 1, y)
    push(x, y + 1)
    push(x, y - 1)
  }
}

async function main() {
  const input = sharp(inputPath).ensureAlpha()
  const { data, info } = await input.clone().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels } = info
  if (channels !== 4) {
    throw new Error(`Expected RGBA, got ${channels} channels`)
  }

  const buf = Buffer.from(data)
  floodTransparentRgba(buf, w, h)

  const trimmed = await sharp(buf, {
    raw: { width: w, height: h, channels: 4 },
  })
    .trim()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, {
      fit: 'contain',
      position: 'centre',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()

  writeFileSync(inputPath, trimmed)
  const meta = await sharp(trimmed).metadata()
  console.log(`Wrote ${inputPath} (${meta.width}×${meta.height}, transparent background)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
