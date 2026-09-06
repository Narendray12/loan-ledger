import { sha256Hex } from './crypto'

const draw = (bmp: ImageBitmap, max: number, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode photo'))),
      'image/jpeg',
      quality,
    )
  })

/**
 * Camera photo -> oriented, resized JPEG (≤1600px, ~200-500 KB) plus a 240px thumbnail.
 * Re-encoding through a canvas also strips EXIF/GPS metadata.
 */
export async function processImage(
  file: Blob,
): Promise<{ full: Blob; thumb: Blob; sha256: string }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
    createImageBitmap(file),
  )
  try {
    const full = await draw(bmp, 1600, 0.82)
    const thumb = await draw(bmp, 240, 0.7)
    return { full, thumb, sha256: await sha256Hex(await full.arrayBuffer()) }
  } finally {
    bmp.close()
  }
}
