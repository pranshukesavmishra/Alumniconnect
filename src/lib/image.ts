// Resize and compress photos on the phone before upload (keeps us inside free storage limits
// and makes uploads fast on mobile data). Output is WebP where supported, otherwise JPEG.

export interface CompressedImage {
  blob: Blob
  width: number
  height: number
  type: 'image/webp' | 'image/jpeg'
  ext: 'webp' | 'jpg'
}

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      // imageOrientation honours EXIF rotation from phone cameras
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      /* fall back to <img> (e.g. HEIC on some browsers fails here and below) */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

let webpSupported: boolean | null = null
function supportsWebp(): boolean {
  if (webpSupported === null) {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    webpSupported = c.toDataURL('image/webp').startsWith('data:image/webp')
  }
  return webpSupported
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo.'))), type, quality))
}

function drawScaled(source: CanvasImageSource, sw: number, sh: number, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sw * scale))
  canvas.height = Math.max(1, Math.round(sh * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the photo on this device.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** iOS Safari caps total canvas memory: release a canvas as soon as we're done with it. */
function release(canvas: HTMLCanvasElement) {
  canvas.width = 0
  canvas.height = 0
}

/**
 * Decodes the photo ONCE and produces one compressed image per requested size (largest first;
 * smaller sizes are drawn from the previous canvas, which is fast and light on memory).
 */
export async function compressImageSizes(file: Blob, sizes: { maxSide: number; quality: number }[]): Promise<CompressedImage[]> {
  const source = await decode(file).catch(() => {
    throw new Error('This photo format isn’t supported. Please choose a JPG or PNG photo.')
  })
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height
  const type = supportsWebp() ? 'image/webp' : 'image/jpeg'
  const ext = type === 'image/webp' ? 'webp' : 'jpg'
  const out: CompressedImage[] = new Array(sizes.length)
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.maxSide - sizes[a]!.maxSide) // largest first
  let prev: { canvas: HTMLCanvasElement; w: number; h: number } | null = null
  try {
    for (const idx of order) {
      const { maxSide, quality } = sizes[idx]!
      const canvas: HTMLCanvasElement = prev ? drawScaled(prev.canvas, prev.w, prev.h, maxSide) : drawScaled(source, sw, sh, maxSide)
      out[idx] = { blob: await toBlob(canvas, type, quality), width: canvas.width, height: canvas.height, type, ext }
      if (prev) release(prev.canvas)
      prev = { canvas, w: canvas.width, h: canvas.height }
    }
  } finally {
    if (prev) release(prev.canvas)
    if ('close' in source) source.close()
  }
  return out // same order as requested
}

export async function compressImage(file: Blob, maxSide: number, quality = 0.82): Promise<CompressedImage> {
  const [img] = await compressImageSizes(file, [{ maxSide, quality }])
  return img!
}

export const AVATAR_SIZE = 480
export const PHOTO_SIZE = 1600
export const THUMB_SIZE = 480
