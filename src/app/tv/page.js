import TvSlideshow from '@/components/TvSlideshow'

export const metadata = {
  title: 'Sugar & Spice',
}

const MODE_TO_ROTATION = {
  '1': 90,
  '2': 180,
  '3': 270,
  '4': 0,
}

export default async function TvPage({ searchParams }) {
  const params = await searchParams
  const mode = typeof params?.mode === 'string' ? params.mode : ''
  const rotation = MODE_TO_ROTATION[mode] ?? 0
  const stageClass = `tv-stage tv-stage--rot${rotation}`

  return (
    <div className={stageClass}>
      <div className="tv-stage-inner">
        <TvSlideshow />
      </div>
    </div>
  )
}
