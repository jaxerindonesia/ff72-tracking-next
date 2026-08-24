import 'dotenv/config'
import express, { type NextFunction, type Request, type Response } from 'express'
import cors from 'cors'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { Prisma } from '@prisma/client'
import { prisma } from './db'
import { createToken, requireAuth, type AuthRequest } from './auth'

const app = express()
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:3000' }))
app.use(express.json({ limit: '100kb' }))

const userId = (req: AuthRequest) => BigInt(req.user!.id)
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, item) => {
  if (typeof item === 'bigint') return item.toString()
  if (Prisma.Decimal.isDecimal(item)) return item.toNumber()
  return item
})) as T

const publicUser = (user: Record<string, unknown>) => json({
  id: user.id, name: user.name, email: user.email, points: user.points,
  phone: user.phone, birth_date: user.birthDate, gender: user.gender, city: user.city,
  weight_kg: user.weightKg, height_cm: user.heightCm, created_at: user.createdAt,
})

const sessionDto = (session: Record<string, unknown>) => json({
  id: session.id, user_id: session.userId, start_time: session.startTime,
  end_time: session.endTime, target_hours: session.targetHours, status: session.status,
  stop_reason: session.stopReason, created_at: session.createdAt,
})

const checkinDto = (item: Record<string, unknown>) => json({
  id: item.id, user_id: item.userId, session_id: item.sessionId, condition: item.condition,
  emoji: item.emoji, water_glasses: item.waterGlasses, jaroliva_taken: item.jarolivaTaken,
  followed_protocol: item.followedProtocol, points_earned: item.pointsEarned, created_at: item.createdAt,
})

const glucoseDto = (item: Record<string, unknown>) => json({
  id: item.id, user_id: item.userId, session_id: item.sessionId, phase: item.phase,
  value: item.value, unit: item.unit, logged_at: item.loggedAt,
})

const ketoneDto = (item: Record<string, unknown>) => json({
  id: item.id, user_id: item.userId, session_id: item.sessionId, phase: item.phase,
  value: item.value, unit: item.unit, logged_at: item.loggedAt,
})

const startOfToday = () => {
  const date = new Date()
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
}

const consumptionScheduleMinutes: Record<string, number> = {
  '1': 6 * 60, '2': 9 * 60, '3': 12 * 60, '4': 15 * 60, '5': 18 * 60, '6': 21 * 60,
}

const jakartaMinutesNow = () => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date())
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0)
  return hour * 60 + minute
}

const nextJakartaDay = (date = new Date()) => {
  const jakarta = new Date(date.getTime() + 7 * 60 * 60 * 1000)
  return new Date(Date.UTC(jakarta.getUTCFullYear(), jakarta.getUTCMonth(), jakarta.getUTCDate() + 1) - 7 * 60 * 60 * 1000)
}

async function syncBadges(id: bigint) {
  const [user, completed, screenings, allBadges] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id } }),
    prisma.fastingSession.count({ where: { userId: id, status: 'completed' } }),
    prisma.screening.count({ where: { userId: id } }),
    prisma.badge.findMany(),
  ])
  const qualifies = (code: string) => ({
    'health-scout': screenings >= 1, 'first-faster': completed >= 1,
    'triple-flame': completed >= 3, 'power-faster': completed >= 5,
    'star-earner': user.points >= 300, 'diamond-member': user.points >= 600,
    'jaxlab-champion': user.points >= 3000, 'fasting-legend': completed >= 10,
  }[code] || false)
  await Promise.all(allBadges.filter((badge) => qualifies(badge.code)).map((badge) =>
    prisma.userBadge.upsert({
      where: { userId_badgeId: { userId: id, badgeId: badge.id } },
      create: { userId: id, badgeId: badge.id }, update: {},
    })
  ))
}

app.get('/api/health', async (_req, res) => {
  try { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true }) }
  catch { res.status(503).json({ ok: false, message: 'Database belum terhubung.' }) }
})

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string }
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ message: 'Nama, email, dan password minimal 8 karakter wajib diisi.' })
  }
  try {
    const user = await prisma.user.create({ data: {
      name: name.trim(), email: email.trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 12),
    } })
    await prisma.notification.create({ data: { userId: user.id, title: 'Selamat datang di JAXLAB+', message: 'Lengkapi profil dan screening kesehatan sebelum memulai FF72.' } })
    return res.status(201).json({ token: createToken(user), user: publicUser(user) })
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    return res.status(duplicate ? 409 : 500).json({ message: duplicate ? 'Email sudah digunakan.' : 'Gagal membuat akun.' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const body = req.body as { email?: string; password?: string }
  const user = await prisma.user.findUnique({ where: { email: body.email?.trim().toLowerCase() || '' } })
  if (!user || !(await bcrypt.compare(body.password || '', user.passwordHash))) {
    return res.status(401).json({ message: 'Email atau password salah.' })
  }
  return res.json({ token: createToken(user), user: publicUser(user) })
})

app.post('/api/auth/google', async (req, res) => {
  const credential = typeof req.body?.credential === 'string' ? req.body.credential : ''
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(503).json({ message: 'Login Google belum dikonfigurasi di server.' })
  if (!credential) return res.status(400).json({ message: 'Token Google tidak ditemukan.' })

  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId })
    const profile = ticket.getPayload()
    if (!profile?.email || !profile.email_verified) {
      return res.status(401).json({ message: 'Email akun Google belum terverifikasi.' })
    }
    const email = profile.email.toLowerCase()
    let user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      user = await prisma.user.create({ data: {
        name: profile.name?.trim() || email.split('@')[0],
        email,
        passwordHash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
      } })
      await prisma.notification.create({ data: {
        userId: user.id,
        title: 'Selamat datang di JAXLAB+',
        message: 'Lengkapi profil dan screening kesehatan sebelum memulai FF72.',
      } })
    }
    return res.json({ token: createToken(user), user: publicUser(user) })
  } catch {
    return res.status(401).json({ message: 'Login Google tidak valid atau sudah kedaluwarsa.' })
  }
})

app.get('/api/me', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const user = await prisma.user.findUnique({ where: { id: userId(req) } })
  if (!user) return res.status(404).json({ message: 'Pengguna tidak ditemukan.' })
  return res.json(publicUser(user))
})

app.put('/api/me', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const body = req.body as Record<string, string>
  const required = ['name', 'phone', 'birthDate', 'gender', 'city', 'weightKg', 'heightCm']
  if (required.some((key) => !body[key]?.trim())) {
    return res.status(400).json({ message: 'Semua data diri wajib diisi sebelum profil disimpan.' })
  }
  const weight = Number(body.weightKg)
  const height = Number(body.heightCm)
  if (!Number.isFinite(weight) || !Number.isFinite(height) || weight < 20 || weight > 400 || height < 80 || height > 250) {
    return res.status(400).json({ message: 'Berat atau tinggi tidak valid.' })
  }
  const user = await prisma.user.update({ where: { id: userId(req) }, data: {
    name: body.name.trim(), phone: body.phone?.trim() || null,
    birthDate: body.birthDate ? new Date(`${body.birthDate}T00:00:00.000Z`) : null,
    gender: body.gender || null, city: body.city?.trim() || null,
    weightKg: weight, heightCm: height,
  } })
  return res.json(publicUser(user))
})

app.get('/api/program', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const id = userId(req)
  const [session, checkins, glucose, ketones, latestScreening] = await Promise.all([
    prisma.fastingSession.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.checkin.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
    prisma.glucoseLog.findMany({ where: { userId: id }, orderBy: { loggedAt: 'asc' } }),
    prisma.ketoneLog.findMany({ where: { userId: id }, orderBy: { loggedAt: 'asc' } }),
    prisma.screening.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' } }),
  ])
  let currentSession = session
  if (session?.status === 'active' && Date.now() - session.startTime.getTime() >= session.targetHours * 3600000) {
    const completed = await prisma.$transaction(async (tx) => {
      const changed = await tx.fastingSession.updateMany({ where: { id: session.id, status: 'active' }, data: { status: 'completed', endTime: new Date(session.startTime.getTime() + session.targetHours * 3600000) } })
      if (!changed.count) return null
      await tx.user.update({ where: { id }, data: { points: { increment: 500 } } })
      await tx.pointTransaction.create({ data: { userId: id, amount: 500, reason: 'Menyelesaikan FF72', sourceType: 'fasting_session', sourceId: session.id.toString() } })
      await tx.notification.create({ data: { userId: id, title: 'Program FF72 selesai! 🎉', message: 'Selamat, Anda memperoleh 500 poin.' } })
      return tx.fastingSession.findUniqueOrThrow({ where: { id: session.id } })
    })
    if (completed) { currentSession = completed; await syncBadges(id) }
  }
  return res.json({
    session: currentSession ? sessionDto(currentSession) : null,
    checkins: checkins.map(checkinDto),
    glucose: glucose.map(glucoseDto),
    ketones: ketones.map(ketoneDto),
    screeningCompleted: Boolean(latestScreening && latestScreening.score >= 60),
    screeningScore: latestScreening?.score ?? null,
    screeningRetryAt: latestScreening && latestScreening.score < 60 ? nextJakartaDay(latestScreening.createdAt) : null,
  })
})

app.post('/api/program/start', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  try {
    const id = userId(req)
    const latestScreening = await prisma.screening.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' } })
    if (!latestScreening || latestScreening.score < 60) {
      return res.status(403).json({ message: latestScreening
        ? 'Hasil screening belum lulus. Anda dapat melakukan screening ulang besok.'
        : 'Selesaikan screening kesehatan sebelum memulai Program FF72.' })
    }
    const session = await prisma.fastingSession.create({ data: { userId: id, startTime: new Date(req.body.startTime) } })
    return res.status(201).json(sessionDto(session))
  } catch (error) {
    const conflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    return res.status(conflict ? 409 : 500).json({ message: conflict ? 'Masih ada program aktif.' : 'Gagal memulai program.' })
  }
})

app.post('/api/program/stop', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const session = await prisma.fastingSession.updateMany({
    where: { id: BigInt(req.body.sessionId), userId: userId(req), status: 'active' },
    data: { status: 'stopped', endTime: new Date(), stopReason: req.body.reason },
  })
  if (!session.count) return res.status(404).json({ message: 'Sesi aktif tidak ditemukan.' })
  const saved = await prisma.fastingSession.findUniqueOrThrow({ where: { id: BigInt(req.body.sessionId) } })
  return res.json(sessionDto(saved))
})

app.post('/api/checkins', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const body = req.body
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const checkin = await tx.checkin.create({ data: {
        userId: userId(req), sessionId: body.sessionId ? BigInt(body.sessionId) : null,
        condition: body.condition, emoji: body.emoji, waterGlasses: body.waterGlasses,
        jarolivaTaken: body.jarolivaTaken, followedProtocol: body.followedProtocol,
      } })
      await tx.user.update({ where: { id: userId(req) }, data: { points: { increment: 10 } } })
      await tx.pointTransaction.create({ data: { userId: userId(req), amount: 10, reason: 'Check-in program', sourceType: 'checkin', sourceId: checkin.id.toString() } })
      return checkin
    })
    await syncBadges(userId(req))
    return res.status(201).json(checkinDto(saved))
  } catch { return res.status(400).json({ message: 'Check-in gagal disimpan.' }) }
})

app.post('/api/glucose', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const body = req.body
  try {
    const saved = await prisma.glucoseLog.create({ data: {
      userId: userId(req), sessionId: body.sessionId ? BigInt(body.sessionId) : null,
      phase: body.phase, value: Number(body.value),
    } })
    return res.status(201).json(glucoseDto(saved))
  } catch { return res.status(400).json({ message: 'Nilai gula darah tidak valid.' }) }
})

app.patch('/api/glucose/:id', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const value = Number(req.body.value)
  if (!Number.isInteger(value) || value < 20 || value > 600 || !req.body.phase) {
    return res.status(400).json({ message: 'Nilai gula darah harus antara 20 dan 600 mg/dL.' })
  }
  try {
    const logId = BigInt(String(req.params.id))
    const changed = await prisma.glucoseLog.updateMany({
      where: { id: logId, userId: userId(req) },
      data: { phase: req.body.phase, value },
    })
    if (!changed.count) return res.status(404).json({ message: 'Catatan gula darah tidak ditemukan.' })
    const saved = await prisma.glucoseLog.findUniqueOrThrow({ where: { id: logId } })
    return res.json(glucoseDto(saved))
  } catch { return res.status(400).json({ message: 'Catatan gula darah gagal diperbarui.' }) }
})

app.post('/api/ketones', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const body = req.body
  const value = Number(body.value)
  if (!Number.isFinite(value) || value < 0 || value > 20) {
    return res.status(400).json({ message: 'Nilai ketone harus antara 0 dan 20 mmol/L.' })
  }
  try {
    const saved = await prisma.ketoneLog.create({ data: {
      userId: userId(req), sessionId: body.sessionId ? BigInt(body.sessionId) : null,
      phase: body.phase, value,
    } })
    return res.status(201).json(ketoneDto(saved))
  } catch { return res.status(400).json({ message: 'Nilai ketone tidak valid.' }) }
})

app.patch('/api/ketones/:id', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const value = Number(req.body.value)
  if (!Number.isFinite(value) || value < 0 || value > 20 || !req.body.phase) {
    return res.status(400).json({ message: 'Nilai ketone harus antara 0 dan 20 mmol/L.' })
  }
  try {
    const logId = BigInt(String(req.params.id))
    const changed = await prisma.ketoneLog.updateMany({
      where: { id: logId, userId: userId(req) },
      data: { phase: req.body.phase, value },
    })
    if (!changed.count) return res.status(404).json({ message: 'Catatan ketone tidak ditemukan.' })
    const saved = await prisma.ketoneLog.findUniqueOrThrow({ where: { id: logId } })
    return res.json(ketoneDto(saved))
  } catch { return res.status(400).json({ message: 'Catatan ketone gagal diperbarui.' }) }
})

app.get('/api/screenings/latest', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const screening = await prisma.screening.findFirst({ where: { userId: userId(req) }, orderBy: { createdAt: 'desc' } })
  return res.json(screening ? json({
    ...screening,
    points_earned: screening.pointsEarned,
    created_at: screening.createdAt,
    retry_at: screening.score < 60 ? nextJakartaDay(screening.createdAt) : null,
  }) : null)
})

app.post('/api/screenings', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const id = userId(req)
  const latest = await prisma.screening.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' } })
  if (latest && latest.score < 60 && new Date() < nextJakartaDay(latest.createdAt)) {
    return res.status(429).json({
      message: 'Screening ulang baru dapat dilakukan besok.',
      retry_at: nextJakartaDay(latest.createdAt),
    })
  }
  const existing = await prisma.screening.count({ where: { userId: id } })
  const points = existing === 0 ? 50 : 0
  const answers = req.body.answers as Record<string, string>
  const risks = ['diabetes', 'hypertension', 'kidneyDisease', 'pregnant', 'breastfeeding', 'medication'].filter((key) => answers[key] === 'Ya').length
  const score = Math.max(20, 100 - risks * 20)
  const status = score >= 60 ? 'ready' : 'failed'
  const screening = await prisma.$transaction(async (tx) => {
    const saved = await tx.screening.create({ data: { userId: id, answers, score, status, pointsEarned: points } })
    if (points) {
      await tx.user.update({ where: { id }, data: { points: { increment: points } } })
      await tx.pointTransaction.create({ data: { userId: id, amount: points, reason: 'Screening kesehatan', sourceType: 'screening', sourceId: saved.id.toString() } })
    }
    return saved
  })
  await syncBadges(id)
  return res.status(201).json(json({
    ...screening,
    points_earned: screening.pointsEarned,
    created_at: screening.createdAt,
    retry_at: score < 60 ? nextJakartaDay(screening.createdAt) : null,
  }))
})

app.get('/api/progress', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const id = userId(req)
  const [user, sessions, totalCheckins] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id } }),
    prisma.fastingSession.findMany({ where: { userId: id }, include: { _count: { select: { checkins: true, glucoseLogs: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.checkin.count({ where: { userId: id } }),
  ])
  const now = Date.now()
  const rows = sessions.map((session) => {
    const end = session.endTime?.getTime() || now
    const duration = Math.min(session.targetHours, Math.max(0, (end - session.startTime.getTime()) / 3600000))
    return { id: session.id.toString(), date: session.startTime.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }), status: session.status, duration_hours: Number(duration.toFixed(1)), checkins: session._count.checkins, glucose_count: session._count.glucoseLogs }
  })
  return res.json({ ff72_selesai: sessions.filter((item) => item.status === 'completed').length, total_poin: user.points, total_checkin: totalCheckins, total_sesi: sessions.length, sessions: rows, chart_data: rows.slice().reverse().map((item, index) => ({ name: `#${index + 1}`, selesai: item.status === 'completed' ? item.duration_hours : 0, void: item.status === 'completed' ? 0 : item.duration_hours })) })
})

app.get('/api/rewards', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const id = userId(req)
  await syncBadges(id)
  const [user, completed, badges, earned, transactions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id } }),
    prisma.fastingSession.count({ where: { userId: id, status: 'completed' } }),
    prisma.badge.findMany({ orderBy: { id: 'asc' } }),
    prisma.userBadge.findMany({ where: { userId: id }, select: { badgeId: true } }),
    prisma.pointTransaction.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ])
  const earnedIds = new Set(earned.map((item) => item.badgeId.toString()))
  return res.json(json({ total_points: user.points, ff72_selesai: completed, badges: badges.map((badge) => ({ ...badge, unlocked: earnedIds.has(badge.id.toString()), desc: badge.description })), transactions, badge_diraih: earned.length, badge_tersisa: badges.length - earned.length }))
})

app.get('/api/consumptions/today', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const logs = await prisma.consumptionLog.findMany({ where: { userId: userId(req), consumedOn: startOfToday() } })
  return res.json(logs.map((item) => item.scheduleKey))
})

app.put('/api/consumptions/:scheduleKey', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const key = String(request.params.scheduleKey)
  const scheduledMinutes = consumptionScheduleMinutes[key]
  if (scheduledMinutes === undefined) return res.status(400).json({ message: 'Jadwal konsumsi tidak valid.' })
  if (request.body.done && jakartaMinutesNow() < scheduledMinutes) {
    const hour = String(Math.floor(scheduledMinutes / 60)).padStart(2, '0')
    const minute = String(scheduledMinutes % 60).padStart(2, '0')
    return res.status(403).json({ message: `Jadwal ini baru dapat dikonfirmasi pukul ${hour}.${minute} WIB.` })
  }
  const unique = { userId: userId(req), scheduleKey: key, consumedOn: startOfToday() }
  if (request.body.done) await prisma.consumptionLog.upsert({ where: { userId_scheduleKey_consumedOn: unique }, create: unique, update: { consumedAt: new Date() } })
  else await prisma.consumptionLog.deleteMany({ where: unique })
  return res.json({ ok: true })
})

app.get('/api/notifications', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  const notifications = await prisma.notification.findMany({ where: { userId: userId(req) }, orderBy: { createdAt: 'desc' }, take: 30 })
  return res.json(json(notifications.map((item) => ({ ...item, read_at: item.readAt, created_at: item.createdAt }))))
})

app.put('/api/notifications/read', requireAuth, async (request, res) => {
  const req = request as AuthRequest
  await prisma.notification.updateMany({ where: { userId: userId(req), readAt: null }, data: { readAt: new Date() } })
  return res.json({ ok: true })
})

app.use('/api', (_req, res) => res.status(404).json({ message: 'Endpoint API tidak ditemukan.' }))
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error)
  res.status(500).json({ message: 'Server gagal memproses permintaan.' })
})

const port = Number(process.env.PORT || 3001)
app.listen(port, () => console.log(`API berjalan di port ${port}`))
