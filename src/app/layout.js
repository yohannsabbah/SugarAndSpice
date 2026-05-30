import './globals.css'

export const metadata = {
  title: 'Sugar & Spice',
  description: 'Sugar & Spice — employee shift tracking',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
