import Link from 'next/link'
import BrandTitle from '@/components/BrandTitle'

export default function HomePage() {
  return (
    <div className="container home-layout">
      <BrandTitle href={null} />
      <div className="card">
        <Link href="/employee" className="btn btn-pink btn-lg btn-block">
          Start a shift
        </Link>
      </div>
    </div>
  )
}
