import { useEffect, useState } from 'react'

export function useConsumptionSchedule() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const update = () => setNow(new Date())
    const interval = window.setInterval(update, 60_000)
    window.addEventListener('focus', update)
    document.addEventListener('visibilitychange', update)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  const jakartaTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const currentHours = Number(jakartaTime.find((part) => part.type === 'hour')?.value || 0)
  const currentMinute = Number(jakartaTime.find((part) => part.type === 'minute')?.value || 0)
  const currentMinutes = currentHours * 60 + currentMinute
  return (time: string) => {
    const [hours, minutes] = time.split('.').map(Number)
    return currentMinutes >= hours * 60 + minutes
  }
}
