import { useEffect, useRef } from 'react'

export type ImagePreviewProps = {
  width: number
  height: number
  /** RGBA8888, row-major, length ``width * height * 4``. */
  rgba: Uint8Array
  className?: string
}

/**
 * Simple bitmap preview (e.g. decoded textures) in a padded, scrollable frame similar to an IDE media preview.
 */
export function ImagePreview({ width, height, rgba, className }: ImagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || width < 1 || height < 1) return
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const copy = new Uint8ClampedArray(width * height * 4)
    copy.set(rgba.subarray(0, copy.length))
    ctx.putImageData(new ImageData(copy, width, height), 0, 0)
  }, [width, height, rgba])

  return (
    <div className={['mission-image-preview', className].filter(Boolean).join(' ')}>
      <div className="mission-image-preview-frame">
        <canvas ref={canvasRef} className="mission-image-preview-canvas" width={width} height={height} />
      </div>
    </div>
  )
}
