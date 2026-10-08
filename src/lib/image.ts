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

export async function compressImage(file: Blob, maxSide: number, quality = 0.82): Promise<CompressedImage> {
  const source = await decode(file).catch(() => {
    throw new Error('This photo format isn’t supported. Please choose a JPG or PNG photo.')
  })
  const sw = 'naturalWidth' in source ? source.naturalWidth : source.width
  const sh = 'naturalHeight' in source ? source.naturalHeight : source.height
  const scale = Math.min(1, maxSide / Math.max(sw, sh))
  const width = Math.max(1, Math.round(sw * scale))
  const height = Math.max(1, Math.round(sh * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process the photo on this device.')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, width, height)
  if ('close' in source) source.close()

  const type = supportsWebp() ? 'image/webp' : 'image/jpeg'
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not compress the photo.'))), type, quality),
  )
  return { blob, width, height, type, ext: type === 'image/webp' ? 'webp' : 'jpg' }
}

export const AVATAR_SIZE = 480
export const PHOTO_SIZE = 1600
export const THUMB_SIZE = 480
