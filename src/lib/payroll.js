// Hourly pay rules, shared by the Shifts tab and the Overview month summary.

export const DEFAULT_HOURLY_RATE = 35.4
export const IRA_HOURLY_RATE = 50

export function isIra(name) {
  return name?.trim().toLowerCase() === 'ira'
}

// Jenny's pay is shown on the Shifts tab but is not part of the total to pay.
export function isJenny(name) {
  return name?.trim().toLowerCase() === 'jenny'
}

export function hourlyRateFor(name) {
  return isIra(name) ? IRA_HOURLY_RATE : DEFAULT_HOURLY_RATE
}
