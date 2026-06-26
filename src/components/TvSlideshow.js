'use client'

import { useEffect, useRef, useState } from 'react'

const IMAGE_DURATION_MS = 7000
const TRANSITION_MS = 2000
const VIDEO_SAFETY_TIMEOUT_MS = 60000

const ANIMATIONS = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'zoom-in',
  'zoom-out',
]

function pickAnim(prev) {
  const choices = ANIMATIONS.filter((a) => a !== prev)
  return choices[Math.floor(Math.random() * choices.length)]
}

function detectType(item) {
  if (item?.type) return item.type
  const name = String(item?.url || item?.file || '').toLowerCase()
  if (/\.(mov|mp4|webm|ogg|m4v)$/.test(name)) return 'video'
  return 'image'
}

function resolveUrl(item, baseUrl) {
  if (item?.url) return item.url
  return (baseUrl || '') + (item?.file || '')
}

function MediaElement({ item, baseUrl, isPlaying, onEnded, onError }) {
  const url = resolveUrl(item, baseUrl)
  const type = detectType(item)
  const videoRef = useRef(null)

  useEffect(() => {
    if (type !== 'video' || !videoRef.current) return
    if (isPlaying) {
      try {
        videoRef.current.currentTime = 0
      } catch {}
      const p = videoRef.current.play()
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } else {
      videoRef.current.pause()
    }
  }, [isPlaying, url, type])

  if (type === 'video') {
    return (
      <video
        key={url}
        ref={videoRef}
        src={url}
        muted
        playsInline
        preload="auto"
        onEnded={onEnded}
        onError={onError}
        className="tv-slide-media"
      />
    )
  }
  return (
    <img
      key={url}
      src={url}
      alt=""
      onError={onError}
      className="tv-slide-media"
    />
  )
}

function Slideshow({ items, baseUrl }) {
  const len = items.length

  const [lanes, setLanes] = useState(() => ({
    A: { idx: 0 },
    B: { idx: len > 1 ? 1 : 0 },
  }))
  const [currentLane, setCurrentLane] = useState('A')
  const [transitioning, setTransitioning] = useState(false)
  const [anim, setAnim] = useState('fade')

  const lastAnimRef = useRef('fade')
  const advancingRef = useRef(false)
  const imageTimerRef = useRef(null)
  const transitionTimerRef = useRef(null)
  const videoTimerRef = useRef(null)

  const clearAllTimers = () => {
    clearTimeout(imageTimerRef.current)
    clearTimeout(transitionTimerRef.current)
    clearTimeout(videoTimerRef.current)
  }

  const advance = () => {
    if (advancingRef.current || len < 2) return
    advancingRef.current = true
    clearAllTimers()

    const newAnim = pickAnim(lastAnimRef.current)
    lastAnimRef.current = newAnim
    setAnim(newAnim)
    setTransitioning(true)

    transitionTimerRef.current = setTimeout(() => {
      setCurrentLane((prev) => {
        const next = prev === 'A' ? 'B' : 'A'
        setLanes((prevLanes) => {
          const newCurrentIdx = prevLanes[next].idx
          const newPreloadIdx = (newCurrentIdx + 1) % len
          return { ...prevLanes, [prev]: { idx: newPreloadIdx } }
        })
        return next
      })
      setTransitioning(false)
      advancingRef.current = false
    }, TRANSITION_MS)
  }

  useEffect(() => () => clearAllTimers(), [])

  useEffect(() => {
    if (transitioning || len < 2) return
    const currentItem = items[lanes[currentLane].idx]
    if (!currentItem) return
    const type = detectType(currentItem)
    if (type === 'video') {
      videoTimerRef.current = setTimeout(advance, VIDEO_SAFETY_TIMEOUT_MS)
      return () => clearTimeout(videoTimerRef.current)
    }
    const dur = currentItem.durationMs ?? IMAGE_DURATION_MS
    imageTimerRef.current = setTimeout(advance, dur)
    return () => clearTimeout(imageTimerRef.current)
  }, [currentLane, transitioning, lanes, len, items])

  const aItem = items[lanes.A.idx]
  const bItem = items[lanes.B.idx]
  const aIsCurrent = currentLane === 'A'
  const bIsCurrent = currentLane === 'B'

  const postTransitionCurrent = transitioning
    ? currentLane === 'A' ? 'B' : 'A'
    : currentLane

  const laneClass = (isCurrent) => {
    if (transitioning) {
      return isCurrent
        ? `tv-slide tv-slide-leaving tv-anim-leave-${anim}`
        : `tv-slide tv-slide-entering tv-anim-enter-${anim}`
    }
    return isCurrent ? 'tv-slide tv-slide-current' : 'tv-slide tv-slide-preload'
  }

  return (
    <div className="tv-slideshow">
      <div className={laneClass(aIsCurrent)}>
        <MediaElement
          item={aItem}
          baseUrl={baseUrl}
          isPlaying={postTransitionCurrent === 'A'}
          onEnded={advance}
          onError={advance}
        />
      </div>
      <div className={laneClass(bIsCurrent)}>
        <MediaElement
          item={bItem}
          baseUrl={baseUrl}
          isPlaying={postTransitionCurrent === 'B'}
          onEnded={advance}
          onError={advance}
        />
      </div>
    </div>
  )
}

export default function TvSlideshow() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/tv-media.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('http ' + r.status)
        return r.json()
      })
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  if (failed || (data && (!data.items || data.items.length === 0))) {
    return <img src="/logo.png" alt="Sugar & Spice" className="tv-logo" />
  }
  if (!data) {
    return <img src="/logo.png" alt="Sugar & Spice" className="tv-logo" />
  }
  return <Slideshow items={data.items} baseUrl={data.baseUrl} />
}
