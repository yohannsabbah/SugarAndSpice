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
  'blur',
  'rotate',
  'tilt',
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

function TextOverlay({ item, hasVerticalLetterbox }) {
  if (!item?.text) return null
  const position = item.textPosition || 'bottom'
  const size = item.textSize || 'medium'
  const align = item.textAlign || 'center'
  const color = item.textColor || '#ffffff'
  const strip = item.textStrip === true
  const wantOutside = item.textOverflow !== false
  const canGoOutside = hasVerticalLetterbox && (position === 'top' || position === 'bottom')
  const useLetterbox = wantOutside && canGoOutside
  const posClass = useLetterbox
    ? `tv-text-pos-${position}-letterbox`
    : `tv-text-pos-${position}`
  return (
    <div
      className={`tv-text-overlay ${posClass} tv-text-size-${size} tv-text-align-${align} ${strip ? '' : 'tv-text-no-strip'}`}
      style={{ color }}
    >
      <span>{item.text}</span>
    </div>
  )
}

function MediaElement({ item, baseUrl, isPlaying, onEnded, onError }) {
  const url = resolveUrl(item, baseUrl)
  const type = detectType(item)
  const videoRef = useRef(null)
  const imgRef = useRef(null)
  const wrapperRef = useRef(null)
  const [aspect, setAspect] = useState(null)
  const [slideAspect, setSlideAspect] = useState(null)

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

  useEffect(() => {
    const wrapper = wrapperRef.current
    const slide = wrapper?.parentElement
    if (!slide) return
    const update = () => {
      const w = slide.offsetWidth
      const h = slide.offsetHeight
      if (w && h) setSlideAspect(w / h)
    }
    update()
    const obs = new ResizeObserver(update)
    obs.observe(slide)
    return () => obs.disconnect()
  }, [])

  function captureAspect() {
    const el = type === 'video' ? videoRef.current : imgRef.current
    if (!el) return
    const w = el.naturalWidth || el.videoWidth
    const h = el.naturalHeight || el.videoHeight
    if (w && h) setAspect(w / h)
  }

  const hasVerticalLetterbox = aspect != null && slideAspect != null && aspect > slideAspect

  return (
    <div
      ref={wrapperRef}
      className="tv-slide-content"
      style={aspect ? { aspectRatio: String(aspect) } : undefined}
    >
      {type === 'video' ? (
        <video
          key={url}
          ref={videoRef}
          src={url}
          muted
          playsInline
          preload="auto"
          onLoadedMetadata={captureAspect}
          onEnded={onEnded}
          onError={onError}
          className="tv-slide-media"
        />
      ) : (
        <img
          key={url}
          ref={imgRef}
          src={url}
          alt=""
          onLoad={captureAspect}
          onError={onError}
          className="tv-slide-media"
        />
      )}
      <TextOverlay item={item} hasVerticalLetterbox={hasVerticalLetterbox} />
    </div>
  )
}

function Preloader({ items, baseUrl }) {
  return (
    <div aria-hidden="true" className="tv-preloader">
      {items.map((item) => {
        const url = resolveUrl(item, baseUrl)
        const type = detectType(item)
        if (type === 'video') {
          return <video key={`pre-${url}`} src={url} muted playsInline preload="auto" />
        }
        return <img key={`pre-${url}`} src={url} alt="" />
      })}
    </div>
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

  const goPrev = () => {
    if (advancingRef.current || len < 2) return
    advancingRef.current = true
    clearAllTimers()

    const otherLane = currentLane === 'A' ? 'B' : 'A'
    const currentIdx = lanes[currentLane].idx
    const prevIdx = (currentIdx - 1 + len) % len

    setLanes((prevLanes) => ({ ...prevLanes, [otherLane]: { idx: prevIdx } }))

    const newAnim = pickAnim(lastAnimRef.current)
    lastAnimRef.current = newAnim
    setAnim(newAnim)
    setTransitioning(true)

    transitionTimerRef.current = setTimeout(() => {
      setCurrentLane(otherLane)
      setLanes((prevLanes) => ({ ...prevLanes, [currentLane]: { idx: (prevIdx - 1 + len) % len } }))
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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') advance()
      else if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLane, lanes, len])

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
      <Preloader items={items} baseUrl={baseUrl} />
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

function isItemVisibleAt(item, date) {
  if (item.hidden) return false
  if (Array.isArray(item.days) && item.days.length > 0 && !item.days.includes(date.getDay())) {
    return false
  }
  const hour = date.getHours()
  const hs = typeof item.hourStart === 'number' ? item.hourStart : 0
  const he = typeof item.hourEnd === 'number' ? item.hourEnd : 24
  if (hour < hs || hour >= he) return false
  return true
}

export default function TvSlideshow() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [previewIdx] = useState(() => {
    if (typeof window === 'undefined') return null
    const num = new URLSearchParams(window.location.search).get('num')
    const parsed = num == null ? NaN : parseInt(num, 10)
    return Number.isFinite(parsed) && parsed >= 1 ? parsed - 1 : null
  })

  useEffect(() => {
    const loadJson = (url) =>
      fetch(url, { cache: 'no-store' }).then((r) => {
        if (!r.ok) throw new Error('http ' + r.status)
        return r.json()
      })
    loadJson('/api/tv/media')
      .catch(() => loadJson('/tv-media_backup.json'))
      .then(setData)
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    if (previewIdx != null) return
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [previewIdx])

  let visibleItems
  if (previewIdx != null && data?.items?.[previewIdx]) {
    visibleItems = [data.items[previewIdx]]
  } else {
    visibleItems = data?.items?.filter((it) => isItemVisibleAt(it, now)) ?? []
  }

  if (failed || (data && visibleItems.length === 0)) {
    return <img src="/logo.png" alt="Sugar & Spice" className="tv-logo" />
  }
  if (!data) {
    return null
  }
  const itemsKey = visibleItems.map((it) => it.url || it.file).join('|')
  return <Slideshow key={itemsKey} items={visibleItems} baseUrl={data.baseUrl} />
}
