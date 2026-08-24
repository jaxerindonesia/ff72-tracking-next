import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Bell, Zap, ChevronRight, Activity, Heart, Package,
  PlayCircle, Users, Flame, Star, Droplets, CheckCircle2, X
} from 'lucide-react'
import CircularProgress from '../components/CircularProgress'
import { useFastingTimer } from '../hooks/useFastingTimer'
import { useConsumptionSchedule } from '../hooks/useConsumptionSchedule'
import {
  activeSession, userStats,
  products, consumptionLog
} from '../data/mockData'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'

const getGkiCategory = (value: number | null) => {
  if (value === null) return null
  if (value < 1) return { label: 'Ketosis Sangat Dalam', tone: 'teal', description: 'Keadaan ketosis sangat dalam. Umumnya hanya dicapai pada puasa berkepanjangan atau intervensi ketogenik tertentu.' }
  if (value <= 3) return { label: 'Ketosis Dalam', tone: 'green', description: 'Ketone cukup dominan dibandingkan glukosa dan menunjukkan keadaan ketosis yang dalam.' }
  if (value <= 6) return { label: 'Ketosis Sederhana', tone: 'yellow', description: 'Tubuh mulai menggunakan ketone secara lebih nyata sebagai sumber energi.' }
  if (value <= 9) return { label: 'Ketosis Ringan', tone: 'orange', description: 'Tubuh mulai meningkatkan penggunaan lemak dan ketone.' }
  return { label: 'Ketosis Minimum', tone: 'red', description: 'Glukosa masih relatif dominan dibandingkan ketone.' }
}

export default function Dashboard() {
  const router = useRouter()
  const navigate = (path) => router.push(path)
  const { user } = useAuth()
  const [dashboardSession, setDashboardSession] = useState(null)
  const [todayWaterGlasses, setTodayWaterGlasses] = useState(0)
  const [latestGlucose, setLatestGlucose] = useState<number | null>(null)
  const [latestKetone, setLatestKetone] = useState<number | null>(null)
  const [consumedKeys, setConsumedKeys] = useState<string[]>([])
  const [databaseNotifications, setDatabaseNotifications] = useState<any[]>([])
  const [selectedConsumption, setSelectedConsumption] = useState<any>(null)
  const isProgramActive = dashboardSession?.status === 'active'
  const sessionStart = dashboardSession?.start_time || '1970-01-01T00:00:00.000Z'
  const timer = useFastingTimer(sessionStart, activeSession.target_hours, isProgramActive ? null : sessionStart)
  const currentDay = Math.min(3, Math.max(1, Math.floor(timer.hours / 24) + 1))
  const isConsumptionDue = useConsumptionSchedule()
  const [showNotifications, setShowNotifications] = useState(false)
  const notificationRef = useRef(null)
  const dueConsumptions = consumptionLog.filter((item) => isConsumptionDue(item.time))
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
  const notificationStorageKey = `jaxlab-consumption-notifications-${todayKey}`
  const [readNotifications, setReadNotifications] = useState(() => {
    try { return JSON.parse(localStorage.getItem(notificationStorageKey)) || [] } catch { return [] }
  })
  const unreadConsumptions = dueConsumptions.filter((item) =>
    !readNotifications.includes(item.id) && !consumedKeys.includes(String(item.id))
  )
  const unreadDatabaseNotifications = databaseNotifications.filter((item) => !item.read_at)
  const gki = latestGlucose !== null && latestKetone !== null && latestKetone > 0
    ? latestGlucose / (18 * latestKetone)
    : null
  const gkiCategory = getGkiCategory(gki)
  useEffect(() => {
    api<any>('/program').then((data) => {
      setDashboardSession(data.session)
      const latestTodayCheckin = data.checkins.find((item) =>
        new Date(item.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }) === todayKey
      )
      setTodayWaterGlasses(Math.min(userStats.water_goal, Math.max(0, Number(latestTodayCheckin?.water_glasses) || 0)))
      const glucose = data.glucose?.at(-1)
      const ketone = data.ketones?.at(-1)
      setLatestGlucose(glucose ? Number(glucose.value) : null)
      setLatestKetone(ketone ? Number(ketone.value) : null)
    }).catch(() => { setDashboardSession(null); setTodayWaterGlasses(0) })
    api<string[]>('/consumptions/today').then(setConsumedKeys).catch(() => {})
    api<any[]>('/notifications').then(setDatabaseNotifications).catch(() => {})
  }, [])
  const toggleNotifications = async () => {
    const opening = !showNotifications
    setShowNotifications(opening)
    if (opening && unreadDatabaseNotifications.length) {
      await api('/notifications/read', { method: 'PUT' })
      setDatabaseNotifications((items) => items.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() })))
    }
  }
  const toggleConsumption = async (id: number) => {
    const key = String(id)
    const done = !consumedKeys.includes(key)
    setConsumedKeys((current) => done ? [...current, key] : current.filter((item) => item !== key))
    await api(`/consumptions/${key}`, { method: 'PUT', body: JSON.stringify({ done }) })
  }
  const confirmConsumption = async () => {
    if (!selectedConsumption) return
    if (!isConsumptionDue(selectedConsumption.time)) return
    await toggleConsumption(selectedConsumption.id)
    setSelectedConsumption(null)
  }
  const openConsumptionReminder = (item) => {
    const nextRead = readNotifications.includes(item.id) ? readNotifications : [...readNotifications, item.id]
    setReadNotifications(nextRead)
    localStorage.setItem(notificationStorageKey, JSON.stringify(nextRead))
    setShowNotifications(false)
    setSelectedConsumption(item)
    window.setTimeout(() => document.querySelector('.consumption-list-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }

  useEffect(() => {
    if (!showNotifications) return undefined
    const closeOnOutsideClick = (event) => {
      if (!notificationRef.current?.contains(event.target)) setShowNotifications(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => document.removeEventListener('mousedown', closeOnOutsideClick)
  }, [showNotifications])

  return (
    <div className="fade-in">
      {/* Top Bar */}
      <div className="top-bar">
        <div>
          <p className="page-greeting">Selamat datang kembali 👋</p>
          <h1 className="page-title">Hi, {user.name}!</h1>
          <p className="page-subtitle">
            {isProgramActive ? 'Program sedang berjalan. Tetap semangat! 🔥' : 'Program FF72 sedang tidak aktif.'}
          </p>
        </div>
        <div className="top-bar-actions dashboard-notification-wrap">
          <div className="notification-trigger" ref={notificationRef}>
            <button className={`icon-btn notification-bell${unreadConsumptions.length + unreadDatabaseNotifications.length ? ' has-notification' : ''}`} aria-label="Buka notifikasi" aria-expanded={showNotifications} onClick={toggleNotifications}>
              <Bell size={18} />
              {unreadConsumptions.length + unreadDatabaseNotifications.length > 0 && <span className="notification-count">{unreadConsumptions.length + unreadDatabaseNotifications.length}</span>}
            </button>
            {showNotifications && <div className="notification-panel">
              <header><div><strong>Pengingat Konsumsi</strong><span>Jadwal hari ini</span></div><Bell size={18} /></header>
              <div className="notification-list">
                {databaseNotifications.map((item) => <div className="notification-item" key={`db-${item.id}`}>
                  <span className="notification-item-icon">🔔</span>
                  <div><strong>{item.title}</strong><p>{item.message}</p><small>{new Date(item.created_at).toLocaleString('id-ID')}</small></div>
                </div>)}
                {unreadConsumptions.length ? [...unreadConsumptions].reverse().map((item, index) => <button className="notification-item" key={item.id} onClick={() => openConsumptionReminder(item)}>
                  <span className="notification-item-icon">{item.emoji}</span>
                  <div><strong>Waktunya konsumsi {item.meal}</strong><p>{item.items}</p><small>{item.time}{index === 0 ? ' · Pengingat terbaru' : ''}</small></div>
                </button>) : !databaseNotifications.length ? <div className="notification-empty"><CheckCircle2 size={24} /><p>Belum ada notifikasi.</p></div> : null}
              </div>
            </div>}
          </div>
          <button className="icon-btn" aria-label="Poin"
            onClick={() => navigate('/reward')}
            style={{ background: 'var(--color-navy)', border: 'none', color: 'white' }}>
            <Zap size={18} />
          </button>
        </div>
      </div>

      {/* Fasting Hero Card */}
      <div className="fasting-hero fade-in fade-in-delay-1">
        <div className="fasting-hero-header">
          <div className={`fasting-status-badge${isProgramActive ? '' : ' inactive'}`}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
            background: isProgramActive ? '#71cf00' : '#a7b3c2', display: 'inline-block'
            }} />
            {isProgramActive ? 'SEDANG BERJALAN' : 'PROGRAM BERHENTI'}
          </div>
          <div className="fasting-day-badge">{isProgramActive ? `Day ${currentDay} of 3` : 'Tidak aktif'}</div>
        </div>

        <div className="fasting-hero-body">
          {/* Circular Timer */}
          <div className="circular-timer-wrapper">
            <CircularProgress
              size={110}
              strokeWidth={9}
              percentage={timer.percentage}
              color={isProgramActive ? '#71cf00' : '#a7b3c2'}
              trackColor="rgba(255,255,255,0.16)"
            >
              <div className="timer-label">Fasting Time</div>
              <div className="timer-time">{timer.timeString}</div>
              <div className="timer-target">/{activeSession.target_hours}:00:00</div>
            </CircularProgress>
          </div>

          {/* Info */}
          <div style={{ flex: 1 }}>
            <h2 className="fasting-hero-title">FF72 Challenge</h2>
            <p className="fasting-hero-desc">
              {isProgramActive ? `Anda sedang berjalan ${timer.hours}j ${timer.minutes}m. Jaga konsumsi lemak sehat!` : 'Timer telah dihentikan dan kembali ke 00:00:00.'}
            </p>
            <button
              className="btn-program"
              onClick={() => navigate('/program')}
            >
              <Zap size={15} /> {isProgramActive ? 'Lihat Program Aktif 🔥' : 'Mulai Program FF72'}
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-item">
            <span className="stat-icon">🔬</span>
            <span className="stat-value">{latestKetone ?? '—'}</span>
            <span className="stat-label">Ketone</span>
            <span className="stat-unit">mmol/L</span>
          </div>
          <div className="stat-item">
            <span className="stat-icon">🩸</span>
            <span className="stat-value">{latestGlucose ?? '—'}</span>
            <span className="stat-label">Glucose</span>
            <span className="stat-unit">mg/dL</span>
          </div>
          <div className="stat-item">
            <span className="stat-icon">⚖️</span>
            <span className="stat-value">{gki === null ? '—' : gki.toFixed(2)}</span>
            <span className="stat-label">GKI Test</span>
            <span className="stat-unit">Glucose ÷ (18 × Ketone)</span>
          </div>
        </div>
      </div>

      <section className="gki-explanation-card fade-in fade-in-delay-2">
        <div className="gki-explanation-heading">
          <div>
            <span className="gki-eyebrow">GLUCOSE KETONE INDEX</span>
            <h2>Cara membaca GKI</h2>
          </div>
          {gkiCategory && <span className={`gki-current-badge ${gkiCategory.tone}`}>{gkiCategory.label}</span>}
        </div>

        <div className="gki-formula">
          <span>Glukosa (mg/dL)</span><b>÷ 18</b><b>÷</b><span>Ketone (mmol/L)</span><b>= GKI</b>
        </div>
        {gki !== null && latestGlucose !== null && latestKetone !== null
          ? <p className="gki-calculation">Perhitungan Anda: {latestGlucose} ÷ 18 ÷ {latestKetone} = <strong>{gki.toFixed(2)}</strong>. {gkiCategory?.description}</p>
          : <p className="gki-calculation">Catat gula darah dan ketone terlebih dahulu agar nilai GKI dapat dihitung.</p>}

        <div className="gki-ranges" aria-label="Kategori nilai GKI">
          <div className="red"><strong>&gt; 9</strong><span>Ketosis Minimum</span></div>
          <div className="orange"><strong>6–9</strong><span>Ketosis Ringan</span></div>
          <div className="yellow"><strong>3–6</strong><span>Ketosis Sederhana</span></div>
          <div className="green"><strong>1–3</strong><span>Ketosis Dalam</span></div>
          <div className="teal"><strong>&lt; 1</strong><span>Ketosis Sangat Dalam</span></div>
        </div>

        <p className="gki-disclaimer"><strong>Penting:</strong> GKI adalah alat perbandingan metabolik, bukan diagnosis atau ukuran langsung kesehatan. Nilai yang lebih rendah tidak otomatis berarti lebih sehat. Pertimbangkan kondisi tubuh, obat, gejala, serta arahan tenaga kesehatan.</p>
      </section>

      {/* Today's Mission */}
      <div className="mission-card fade-in fade-in-delay-2">
        <div className="mission-header">
          <div className="mission-title">
            <span className="mission-title-icon"><Droplets size={17} /></span>
            <span>
              TODAY'S MISSION
              <small>Minum {userStats.water_goal} gelas air hari ini</small>
            </span>
          </div>
          <span className="mission-count">
            {todayWaterGlasses} / {userStats.water_goal}
          </span>
        </div>
        <div className="water-pills">
          {Array.from({ length: userStats.water_goal }).map((_, i) => (
            <div
              key={i}
              className={`water-pill${i < todayWaterGlasses ? ' filled' : ''}`}
              title={`Gelas ke-${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Produk Protokol */}
      <div className="product-protocol-panel fade-in fade-in-delay-3">
        <div className="section-header">
          <div className="section-title product-protocol-title">
            <Package size={15} />
            Produk Protokol FF72
          </div>
          <button className="section-link" onClick={() => navigate('/program')}>
            Lihat jadwal <ChevronRight size={14} />
          </button>
        </div>
        <div className="product-scroll">
          {products.map((p) => (
            <div key={p.id} className="product-card">
              <div className="product-img-wrapper">
                <img
                  src={p.img}
                  alt={p.name}
                  className="product-img"
                  onError={(event) => {
                    event.currentTarget.style.display = 'none'
                    const placeholder = event.currentTarget.nextElementSibling as HTMLElement | null
                    if (placeholder) placeholder.style.display = 'flex'
                  }}
                />
                <div className="product-img-placeholder" style={{ display: 'none', fontSize: 28 }}>
                  🧴
                </div>
              </div>
              <div className="product-name">{p.name}</div>
              <div className="product-qty-badge">{p.qty}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pengingat Konsumsi */}
      <div className="fade-in fade-in-delay-4" style={{ marginBottom: 24 }}>
        <div className="section-header">
          <div className="section-title">
            🔔 Pengingat Konsumsi Hari Ini
          </div>
          <button className="section-link" onClick={() => navigate('/program')}>
            Detail <ChevronRight size={14} />
          </button>
        </div>
        <div className="card consumption-list-card">
          {consumptionLog.map((item) => {
            const consumed = consumedKeys.includes(String(item.id))
            const available = isConsumptionDue(item.time)
            return <div key={item.id} role="button" tabIndex={available ? 0 : -1} aria-disabled={!available} onClick={() => { if (available) setSelectedConsumption(item) }} onKeyDown={(event) => { if (available && (event.key === 'Enter' || event.key === ' ')) setSelectedConsumption(item) }} className={`consumption-item${consumed ? ' consumption-item-consumed' : ''}${available ? '' : ' consumption-item-locked'}`}>
              <div className="consumption-time-block">
                <span className="consumption-time-text">{item.time}</span>
                {consumed && (
                  <span className="consumption-done-dot" title="Sudah dikonsumsi">✓</span>
                )}
              </div>
              <div
                className="consumption-icon"
                style={{ background: `${item.color}18`, fontSize: 18 }}
              >
                {item.emoji}
              </div>
              <div className="consumption-text" style={{ flex: 1 }}>
                <h4>{item.meal} — {item.items}</h4>
                <p>{item.detail}</p>
                {!available && <small className="consumption-locked-label">Tersedia pukul {item.time} WIB</small>}
              </div>
              {available ? <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} /> : <span className="consumption-lock" aria-hidden="true">🔒</span>}
            </div>
          })}
        </div>
      </div>

      {selectedConsumption && createPortal(
        <div className="consumption-confirm-overlay" role="presentation" onMouseDown={() => setSelectedConsumption(null)}>
          <section className="consumption-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="consumption-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="consumption-confirm-close" type="button" aria-label="Tutup" onClick={() => setSelectedConsumption(null)}><X size={18} /></button>
            <div className="consumption-confirm-icon">{selectedConsumption.emoji}</div>
            <small>{selectedConsumption.meal} · {selectedConsumption.time}</small>
            <h2 id="consumption-confirm-title">{consumedKeys.includes(String(selectedConsumption.id)) ? 'Sudah selesai mengonsumsi?' : 'Waktunya konsumsi'}</h2>
            <p>Apakah Anda akan mengonsumsi <strong>{selectedConsumption.items.replaceAll(' + ', ' dan ')}</strong>?</p>
            <div className="consumption-confirm-detail">{selectedConsumption.detail}</div>
            <div className="consumption-confirm-actions">
              <button type="button" className="consumption-confirm-cancel" onClick={() => setSelectedConsumption(null)}>Nanti</button>
              <button type="button" className="consumption-confirm-yes" onClick={confirmConsumption}><CheckCircle2 size={17} /> {consumedKeys.includes(String(selectedConsumption.id)) ? 'Batalkan tanda selesai' : 'Ya, sudah konsumsi'}</button>
            </div>
          </section>
        </div>,
        document.body,
      )}

      {/* Aksi Cepat */}
      <div className="quick-actions-section fade-in fade-in-delay-4">
        <div className="section-title quick-actions-title">
          Aksi Cepat
        </div>
        <div className="quick-actions-grid">
          <button
            className="quick-action-btn"
            onClick={() => navigate('/progress')}
          >
            <div className="quick-action-icon" style={{ background: 'rgba(232, 64, 64, 0.1)' }}>
              <Heart size={20} style={{ color: '#E84040' }} />
            </div>
            <span className="quick-action-copy"><strong>Log Kesehatan</strong></span>
          </button>
          <button
            className="quick-action-btn"
            onClick={() => navigate('/program')}
          >
            <div className="quick-action-icon" style={{ background: 'rgba(74, 144, 217, 0.1)' }}>
              <Activity size={20} style={{ color: '#4A90D9' }} />
            </div>
            <span className="quick-action-copy"><strong>Panduan Produk</strong></span>
          </button>
          <button
            className="quick-action-btn"
            onClick={() => navigate('/program')}
          >
            <div className="quick-action-icon quick-action-icon-green">
              <PlayCircle size={21} />
            </div>
            <span className="quick-action-copy"><strong>Video Edukasi</strong></span>
          </button>
          <button
            className="quick-action-btn"
            onClick={() => navigate('/komunitas')}
          >
            <div className="quick-action-icon quick-action-icon-purple">
              <Users size={21} />
            </div>
            <span className="quick-action-copy"><strong>Komunitas</strong></span>
          </button>
          <button className="quick-action-btn quick-action-stat" onClick={() => navigate('/progress')}>
            <div className="quick-action-icon quick-action-icon-orange">
              <Flame size={21} />
            </div>
            <span className="quick-action-copy">
              <strong>0x</strong>
              <small>FF72 Selesai</small>
            </span>
          </button>
          <button className="quick-action-btn quick-action-stat" onClick={() => navigate('/reward')}>
            <div className="quick-action-icon quick-action-icon-yellow">
              <Star size={21} />
            </div>
            <span className="quick-action-copy">
              <strong>0</strong>
              <small>Total Poin</small>
            </span>
          </button>
          {false && <><button className="notification-backdrop" aria-label="Tutup notifikasi" onClick={() => setShowNotifications(false)} /><div className="notification-panel">
            <header><div><strong>Pengingat Konsumsi</strong><span>Jadwal hari ini</span></div><Bell size={18} /></header>
            <div className="notification-list">
              {unreadConsumptions.length ? [...unreadConsumptions].reverse().map((item, index) => <button className="notification-item" key={item.id} onClick={() => openConsumptionReminder(item)}>
                <span className="notification-item-icon">{item.emoji}</span>
                <div><strong>Waktunya konsumsi {item.meal}</strong><p>{item.items}</p><small>{item.time}{index === 0 ? ' · Pengingat terbaru' : ''}</small></div>
              </button>) : <div className="notification-empty"><CheckCircle2 size={24} /><p>Semua pengingat sudah dibuka.</p></div>}
            </div>
          </div></>}
        </div>
      </div>
    </div>
  )
}
