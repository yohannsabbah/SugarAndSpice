// Browser-side preparation of a receipt photo before upload.
// scaledSize and sha256Hex also run in Node, so the verify script covers them.

export function scaledSize(width, height, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// Decodes through an <img> rather than createImageBitmap: Safari decodes HEIC
// from the iPhone photo library this way, and browsers apply EXIF rotation to
// <img> by default, so the canvas receives an upright picture.
export function downscaleToJpeg(file, { maxEdge = 1600, quality = 0.8 } = {}) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const { width, height } = scaledSize(img.naturalWidth, img.naturalHeight, maxEdge)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the photo'))),
        'image/jpeg',
        quality,
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the photo'))
    }
    img.src = url
  })
}
