import { useEffect, useState } from 'react'
import heroImg from '../assets/hero.png'

const MIN_VISIBLE_MS = 1200

/** One shared gate so React Strict Mode does not run two independent splash timers in dev. */
function splashReady(): Promise<void> {
  type GlobalSplash = { promise: Promise<void> | null }
  const g = globalThis as typeof globalThis & { __launchpadSplash?: GlobalSplash }
  if (!g.__launchpadSplash) g.__launchpadSplash = { promise: null }
  if (g.__launchpadSplash.promise) return g.__launchpadSplash.promise

  g.__launchpadSplash.promise = new Promise((resolve) => {
    const t0 = performance.now()
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      const elapsed = performance.now() - t0
      const rest = Math.max(0, MIN_VISIBLE_MS - elapsed)
      window.setTimeout(resolve, rest)
    }
    const img = new Image()
    img.onload = () => finish()
    img.onerror = () => finish()
    img.src = heroImg
    if (img.complete) finish()
  })
  return g.__launchpadSplash.promise
}

export function SplashScreen() {
  const [phase, setPhase] = useState<'show' | 'hide' | 'gone'>('show')

  useEffect(() => {
    let cancelled = false
    void splashReady().then(() => {
      if (!cancelled) setPhase('hide')
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (phase !== 'hide') return undefined
    const id = window.setTimeout(() => setPhase('gone'), 400)
    return () => window.clearTimeout(id)
  }, [phase])

  if (phase === 'gone') return null

  return (
    <div
      className={`splash-screen${phase === 'hide' ? ' splash-screen--hide' : ''}`}
      aria-hidden="true"
    >
      <img src={heroImg} alt="" className="splash-screen__img" draggable={false} />
    </div>
  )
}
