'use client'

import { useEffect, useMemo, useState } from 'react'
import './sales.css'

export default function SalesCalendarPage() {
  const [salesData, setSalesData] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentDate, setCurrentDate] = useState(() => {
    // Default to the most recent month with data; fall back to today
    return new Date()
  })

  useEffect(() => {
    fetch('/sales-data.json')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d) => {
        setSalesData(d || {})
        // Jump to the latest month that has data
        const keys = Object.keys(d || {}).sort()
        if (keys.length) {
          const latest = keys[keys.length - 1]
          const [y, m] = latest.split('-').map(Number)
          setCurrentDate(new Date(y, m - 1, 1))
        }
      })
      .catch(() => setError('Could not load sales data'))
      .finally(() => setLoading(false))
  }, [])

  const monthInfo = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    const startWeekday = firstDay.getDay()
    const daysInMonth = lastDay.getDate()
    const days = []
    for (let i = 0; i < startWeekday; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(d)
    let monthTotal = 0
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (salesData[key]) monthTotal += salesData[key]
    }
    return { year, month, days, monthTotal }
  }, [currentDate, salesData])

  function changeMonth(delta) {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + delta, 1))
  }

  function goToday() {
    setCurrentDate(new Date())
  }

  if (loading) return <div className="card muted">Loading sales data…</div>
  if (error) return <div className="error">{error}</div>

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => changeMonth(-1)}>
              ← Previous
            </button>
            <button className="btn btn-ghost" onClick={goToday}>
              Today
            </button>
            <button className="btn btn-ghost" onClick={() => changeMonth(1)}>
              Next →
            </button>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>
              {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </div>
            <div className="muted" style={{ fontSize: '0.9rem' }}>
              Monthly total:{' '}
              <strong style={{ color: 'var(--brand-blue-dark)' }}>
                ₪{monthInfo.monthTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="sales-grid">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <div key={d} className="sales-weekday">
              {d}
            </div>
          ))}
          {monthInfo.days.map((d, i) => {
            if (d == null) return <div key={`empty-${i}`} className="sales-day sales-day-empty" />
            const key = `${monthInfo.year}-${String(monthInfo.month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
            const amount = salesData[key]
            const isToday = new Date().toDateString() === new Date(monthInfo.year, monthInfo.month, d).toDateString()
            return (
              <div key={key} className={`sales-day${isToday ? ' sales-day-today' : ''}`}>
                <div className="sales-day-num">{d}</div>
                {amount ? (
                  <div className="sales-day-amount">
                    ₪{amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </div>
                ) : (
                  <div className="sales-day-empty-text">—</div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
