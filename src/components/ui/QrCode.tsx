import QRCode from 'qrcode'
import { useEffect, useState } from 'react'
import { Skeleton } from './Display'

/** Renders a QR code as inline SVG (crisp at any size, works offline). */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0c1e45', light: '#ffffff' } })
      .then((s) => !cancelled && setSvg(s))
      .catch(() => !cancelled && setSvg(null))
    return () => {
      cancelled = true
    }
  }, [value])
  if (!svg) return <Skeleton className="rounded-2xl" />
  return (
    <div
      role="img"
      aria-label={label}
      className="rounded-2xl bg-white p-2 [&>svg]:size-full"
      style={{ width: size, height: size }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
