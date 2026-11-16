'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { GoogleGenAI } from '@google/genai'
import fs from 'fs/promises'
import path from 'path'
import dns from 'dns/promises'

type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string }

type FoodGroup = 'fruit' | 'vegetable' | 'protein' | 'grain' | 'dairy' | 'treat'

const clean = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const DEDICATED_ADMIN_EMAIL = 'admin@foodfriends.com'
const DEDICATED_ADMIN_PASSWORD = 'admin123456'

export type UserSession = {
  id: string
  email: string
  displayName: string
  ageGroup: string
  points: number
  streak: number
  isAdmin: boolean
}

function calculateAccuratePointsAndStreak(dates: string[]): { points: number; streak: number } {
  const points = dates.length * 15
  if (dates.length === 0) return { points: 0, streak: 0 }

  const toKey = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const uniqueDays = new Set<string>()
  dates.forEach((iso) => {
    if (!iso) return
    const d = new Date(iso)
    if (!Number.isNaN(d.getTime())) {
      uniqueDays.add(toKey(d))
    }
  })

  if (uniqueDays.size === 0) return { points, streak: 0 }

  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  let cursor = new Date(today)
  if (!uniqueDays.has(toKey(today))) {
    if (uniqueDays.has(toKey(yesterday))) {
      cursor = yesterday
    } else {
      return { points, streak: 0 }
    }
  }

  let streak = 0
  while (uniqueDays.has(toKey(cursor))) {
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return { points, streak }
}

async function fetchAccurateUserStats(userId?: string | null): Promise<{
  points: number
  streak: number
}> {
  try {
    const adminDb = createAdminClient()
    let query = adminDb
      .from('food_logs')
      .select('created_at')
      .neq('id', '00000000-0000-0000-0000-000000000b17')
      .neq('food_name', 'BrainBitesConfig')
      .neq('food_group', '__brain_bites__')
      .order('created_at', { ascending: false })

    if (userId) {
      query = query.eq('user_id', userId)
    }

    const { data } = await query
    const dates = (data || []).map((r) => String(r.created_at || ''))
    const stats = calculateAccuratePointsAndStreak(dates)

    if (userId) {
      await adminDb
        .from('profiles')
        .update({ points: stats.points, streak: stats.streak })
        .eq('id', userId)
    }

    return stats
  } catch {
    return { points: 0, streak: 0 }
  }
}

export async function sessionAction(): Promise<ActionResult<UserSession | null>> {
  try {
    const cookieStore = await cookies()
    const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'

    if (isAdminCookie) {
      const accurateStats = await fetchAccurateUserStats(null)
      let customAdmin = {
        displayName: 'System Admin',
        ageGroup: 'Admin',
      }
      try {
        const raw = cookieStore.get('foodfriends_admin_profile')?.value
        if (raw) {
          const parsed = JSON.parse(raw)
          customAdmin = {
            displayName: parsed.displayName || 'System Admin',
            ageGroup: parsed.ageGroup || 'Admin',
          }
        }
      } catch {
        // use defaults
      }
      return {
        ok: true,
        data: {
          id: 'admin-master',
          email: DEDICATED_ADMIN_EMAIL,
          displayName: customAdmin.displayName,
          ageGroup: customAdmin.ageGroup,
          points: accurateStats.points,
          streak: accurateStats.streak,
          isAdmin: true,
        },
      }
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: true, data: null }

    const adminDb = createAdminClient()
    const [{ data: profile }, accurateStats] = await Promise.all([
      adminDb.from('profiles').select('*').eq('id', user.id).single(),
      fetchAccurateUserStats(user.id),
    ])

    const isAdmin = Boolean(profile?.is_admin || user.email === DEDICATED_ADMIN_EMAIL)

    return {
      ok: true,
      data: {
        id: user.id,
        email: user.email || '',
        displayName: profile?.display_name || user.user_metadata?.displayName || 'Explorer',
        ageGroup: profile?.age_group || '7-9',
        points: accurateStats.points,
        streak: accurateStats.streak,
        isAdmin,
      },
    }
  } catch {
    return { ok: true, data: null }
  }
}

export async function updateOwnProfileAction(input: {
  displayName: string
  ageGroup: string
  points?: number
  streak?: number
}): Promise<ActionResult<UserSession>> {
  try {
    const displayName = clean(input.displayName, 40)
    const ageGroup = clean(input.ageGroup, 20) || '7-9'
    if (displayName.length < 2) {
      return { ok: false, error: 'Display name must be at least 2 characters.' }
    }

    const cookieStore = await cookies()
    const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'

    if (isAdminCookie) {
      const accurateStats = await fetchAccurateUserStats(null)
      const updatedProfile = {
        displayName,
        ageGroup,
      }

      cookieStore.set('foodfriends_admin_profile', JSON.stringify(updatedProfile), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30,
      })

      return {
        ok: true,
        data: {
          id: 'admin-master',
          email: DEDICATED_ADMIN_EMAIL,
          displayName,
          ageGroup,
          points: accurateStats.points,
          streak: accurateStats.streak,
          isAdmin: true,
        },
      }
    }

    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { ok: false, error: 'Please sign in to update your profile.' }
    }

    const adminDb = createAdminClient()
    const [{ data: existing }, accurateStats] = await Promise.all([
      adminDb.from('profiles').select('*').eq('id', user.id).single(),
      fetchAccurateUserStats(user.id),
    ])

    const isAdmin = Boolean(existing?.is_admin || user.email === DEDICATED_ADMIN_EMAIL)

    const { error } = await adminDb.from('profiles').upsert({
      id: user.id,
      email: user.email || existing?.email || '',
      display_name: displayName,
      age_group: ageGroup,
      points: accurateStats.points,
      streak: accurateStats.streak,
      is_admin: isAdmin,
    })

    if (error) {
      return { ok: false, error: error.message }
    }

    return {
      ok: true,
      data: {
        id: user.id,
        email: user.email || '',
        displayName,
        ageGroup,
        points: accurateStats.points,
        streak: accurateStats.streak,
        isAdmin,
      },
    }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not update profile.',
    }
  }
}

export async function loginAction(input: {
  email: string
  password: string
}): Promise<ActionResult<UserSession>> {
  const email = clean(input.email, 120).toLowerCase()
  const password = clean(input.password, 128)

  if (!email.includes('@') || password.length < 6) {
    return { ok: false, error: 'Check your email and use at least 6 password characters.' }
  }

  // 1. Check for dedicated Admin Account
  if (email === DEDICATED_ADMIN_EMAIL && password === DEDICATED_ADMIN_PASSWORD) {
    const cookieStore = await cookies()
    cookieStore.set('foodfriends_admin_session', 'true', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    const accurateStats = await fetchAccurateUserStats(null)

    return {
      ok: true,
      data: {
        id: 'admin-master',
        email: DEDICATED_ADMIN_EMAIL,
        displayName: 'System Admin',
        ageGroup: 'Admin',
        points: accurateStats.points,
        streak: accurateStats.streak,
        isAdmin: true,
      },
    }
  }

  // 2. Regular Supabase User Login
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !data.user) {
      return { ok: false, error: error?.message || 'That email or password did not match.' }
    }

    const adminDb = createAdminClient()
    const [{ data: profile }, accurateStats] = await Promise.all([
      adminDb.from('profiles').select('*').eq('id', data.user.id).single(),
      fetchAccurateUserStats(data.user.id),
    ])

    const isAdmin = Boolean(profile?.is_admin || data.user.email === DEDICATED_ADMIN_EMAIL)

    // Clear admin cookie if regular user logs in
    const cookieStore = await cookies()
    cookieStore.delete('foodfriends_admin_session')

    return {
      ok: true,
      data: {
        id: data.user.id,
        email: data.user.email || '',
        displayName: profile?.display_name || data.user.user_metadata?.displayName || 'Explorer',
        ageGroup: profile?.age_group || '7-9',
        points: accurateStats.points,
        streak: accurateStats.streak,
        isAdmin,
      },
    }
  } catch {
    return { ok: false, error: 'That email or password did not match.' }
  }
}

const BLOCKED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'testing.com',
  'fake.com',
  'invalid.com',
  'localhost',
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'temp-mail.org',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
  'getnada.com',
  'maildrop.cc',
  'dispostable.com',
  'throwawaymail.com',
  'none.com',
  'noemail.com',
])

const BLOCKED_FAKE_LOCAL_PARTS = new Set([
  'test',
  'testing',
  'fake',
  'none',
  'null',
  'admin',
  'user',
  'example',
  'asdf',
  'qwerty',
  '123',
  '1234',
  '12345',
  '123456',
])

async function verifyActiveEmailAddress(
  rawEmail: string
): Promise<{ valid: true } | { valid: false; reason: string }> {
  const email = rawEmail.trim().toLowerCase()
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/
  if (!emailRegex.test(email)) {
    return {
      valid: false,
      reason: 'Please enter a valid email address (for example, yourname@gmail.com).',
    }
  }

  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) {
    return { valid: false, reason: 'Please enter a complete email address.' }
  }

  if (BLOCKED_EMAIL_DOMAINS.has(domain)) {
    return {
      valid: false,
      reason:
        'Disposable or placeholder email domains are not allowed. Please use an active personal, school, or work email.',
    }
  }

  const cleanLocal = localPart.replace(/\./g, '')
  if (cleanLocal.length < 3 || BLOCKED_FAKE_LOCAL_PARTS.has(cleanLocal)) {
    return {
      valid: false,
      reason: 'That email address looks like a test placeholder. Please use your real active email.',
    }
  }

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    if (
      cleanLocal.length < 6 ||
      localPart.startsWith('.') ||
      localPart.endsWith('.') ||
      localPart.includes('..')
    ) {
      return {
        valid: false,
        reason:
          'Active Gmail addresses must have at least 6 characters before @gmail.com. Please enter your real Gmail address.',
      }
    }
  }

  // Live DNS MX Record check to verify the domain has active mail servers
  try {
    const mxRecords = await dns.resolveMx(domain)
    const hasValidMx =
      Array.isArray(mxRecords) &&
      mxRecords.length > 0 &&
      mxRecords.some((r) => typeof r.exchange === 'string' && r.exchange.trim().length > 0)

    if (!hasValidMx) {
      return {
        valid: false,
        reason: `The domain "@${domain}" does not have an active mail server. Please use an active email address.`,
      }
    }
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || ''
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'EREFUSED') {
      return {
        valid: false,
        reason: `The email domain "@${domain}" does not exist or cannot receive mail. Please use an active email address.`,
      }
    }
    // If DNS resolver is unreachable in a restricted network environment, allow known major providers
    const trustedProviders = new Set([
      'gmail.com',
      'yahoo.com',
      'outlook.com',
      'hotmail.com',
      'icloud.com',
      'live.com',
      'msn.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
    ])
    if (
      !trustedProviders.has(domain) &&
      !domain.endsWith('.edu') &&
      !domain.endsWith('.edu.ph') &&
      !domain.endsWith('.gov')
    ) {
      return {
        valid: false,
        reason: `Could not verify an active mail server for "@${domain}". Please use a verified email provider (such as Gmail, Yahoo, Outlook, iCloud, or school email).`,
      }
    }
  }

  return { valid: true }
}

export type SignupOtpChallenge = {
  email: string
  expiresInSeconds: number
}

export async function requestSignupOtpAction(input: {
  displayName: string
  email: string
  password: string
  ageGroup: string
  redirectOrigin?: string
}): Promise<ActionResult<SignupOtpChallenge>> {
  const displayName = clean(input.displayName, 40)
  const email = clean(input.email, 120).toLowerCase()
  const password = clean(input.password, 128)
  const ageGroup: '4-6' | '7-9' | '10-12' =
    input.ageGroup === '4-6' || input.ageGroup === '10-12' ? input.ageGroup : '7-9'

  if (displayName.length < 2) {
    return { ok: false, error: 'Please add a first name or nickname (at least 2 characters).' }
  }
  if (password.length < 8) {
    return { ok: false, error: 'Your password must be at least 8 characters long.' }
  }
  if (email === DEDICATED_ADMIN_EMAIL) {
    return {
      ok: false,
      error: 'That email is reserved for system administration. Please sign in instead.',
    }
  }

  // 1. Verify that the email address is real and has an active mail server (DNS MX verification)
  const emailCheck = await verifyActiveEmailAddress(email)
  if (!emailCheck.valid) {
    return { ok: false, error: emailCheck.reason }
  }

  // 2. Check if the email is already registered in profiles
  try {
    const adminDb = createAdminClient()
    const { data: existingProfile } = await adminDb
      .from('profiles')
      .select('id, email')
      .eq('email', email)
      .maybeSingle()

    if (existingProfile?.id) {
      return {
        ok: false,
        error: 'An account with this email already exists. Please switch to Sign In.',
      }
    }
  } catch {
    // continue if profiles lookup fails
  }

  // 3. Dispatch real OTP email to the user's inbox via Resend (if configured) or Supabase Auth OTP
  const customOtpCode = String(Math.floor(100000 + Math.random() * 900000))
  const expiresAt = Date.now() + 10 * 60 * 1000
  let sentViaResend = false

  const resendApiKey = process.env.RESEND_API_KEY
  if (resendApiKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || 'FoodFriends <onboarding@resend.dev>',
          to: [email],
          subject: `${customOtpCode} is your FoodFriends verification code`,
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;border-radius:16px;background:#FFFDF7;border:1px solid #DCE6DF;">
            <h2 style="color:#173C4A;margin-top:0;">🍌 Welcome to FoodFriends, ${displayName}!</h2>
            <p style="color:#4A5D52;font-size:15px;">Enter this OTP verification code in the app to finish creating your Explorer account:</p>
            <div style="font-size:32px;font-weight:900;letter-spacing:6px;text-align:center;padding:16px;background:#EAF7DE;color:#287A52;border-radius:12px;margin:20px 0;">${customOtpCode}</div>
            <p style="color:#7A897F;font-size:12px;">This code expires in 10 minutes.</p>
          </div>`,
        }),
      })
      if (res.ok) {
        sentViaResend = true
      }
    } catch {
      // Fallback to Supabase Auth email below
    }
  }

  if (!sentViaResend) {
    try {
      // Use non-PKCE (implicit flow) client so the email verification link returns access_token/refresh_token directly
      // whether the user clicks "Sign in" in Gmail OR pastes the link into the verification box!
      const implicitSupabase = createAdminClient()
      const cleanOrigin = clean(input.redirectOrigin, 200) || 'http://localhost:3000'
      const { error: otpError } = await implicitSupabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          emailRedirectTo: cleanOrigin,
          data: {
            displayName,
            ageGroup,
          },
        },
      })

      if (otpError) {
        return {
          ok: false,
          error: `Could not send verification email to ${email}: ${otpError.message}`,
        }
      }
    } catch {
      return {
        ok: false,
        error: 'Could not dispatch the verification email right now. Please try again in a moment.',
      }
    }
  }

  // 4. Store pending registration metadata in httpOnly cookie (10 min expiry)
  const cookieStore = await cookies()
  cookieStore.set(
    'foodfriends_pending_otp',
    JSON.stringify({
      displayName,
      email,
      password,
      ageGroup,
      customOtpCode: sentViaResend ? customOtpCode : null,
      expiresAt,
    }),
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 10,
    }
  )

  return {
    ok: true,
    data: {
      email,
      expiresInSeconds: 600,
    },
  }
}

export async function verifySignupOtpAction(input: {
  email: string
  otpCode: string
}): Promise<ActionResult<UserSession>> {
  const email = clean(input.email, 120).toLowerCase()
  const rawInput = clean(input.otpCode, 1000)
  const digitsOnly = rawInput.replace(/\D/g, '')

  // Check if user pasted a full verification URL or a pkce_ token from Supabase's email
  let extractedTokenHash: string | null = null
  let extractedLinkType: string | null = null
  let fullVerifyUrl: string | null = null

  if (rawInput.startsWith('http://') || rawInput.startsWith('https://')) {
    try {
      const urlObj = new URL(rawInput)
      extractedTokenHash =
        urlObj.searchParams.get('token') || urlObj.searchParams.get('token_hash')
      extractedLinkType = urlObj.searchParams.get('type')
      if (rawInput.includes('/auth/v1/verify')) {
        fullVerifyUrl = rawInput
      }
    } catch {
      const match = rawInput.match(/[?&]token=([^&#\s]+)/)
      if (match?.[1]) extractedTokenHash = decodeURIComponent(match[1])
      const typeMatch = rawInput.match(/[?&]type=([^&#\s]+)/)
      if (typeMatch?.[1]) extractedLinkType = decodeURIComponent(typeMatch[1])
    }
  } else if (rawInput.includes('token=')) {
    const match = rawInput.match(/[?&]token=([^&#\s]+)/)
    if (match?.[1]) extractedTokenHash = decodeURIComponent(match[1])
    const typeMatch = rawInput.match(/[?&]type=([^&#\s]+)/)
    if (typeMatch?.[1]) extractedLinkType = decodeURIComponent(typeMatch[1])
  } else if (rawInput.startsWith('pkce_') || rawInput.length > 20) {
    extractedTokenHash = rawInput.trim()
  }

  if (!extractedTokenHash && (digitsOnly.length < 6 || digitsOnly.length > 8)) {
    return {
      ok: false,
      error:
        'Please enter the 6-digit OTP code or paste the Sign-in link from your email.',
    }
  }

  const cookieStore = await cookies()
  const rawPending = cookieStore.get('foodfriends_pending_otp')?.value
  if (!rawPending) {
    return {
      ok: false,
      error: 'Your OTP session expired. Please click "Resend OTP Code" to get a new email.',
    }
  }

  let pending: {
    displayName: string
    email: string
    password: string
    ageGroup: '4-6' | '7-9' | '10-12'
    customOtpCode: string | null
    expiresAt: number
  }

  try {
    pending = JSON.parse(rawPending)
  } catch {
    return { ok: false, error: 'Invalid OTP session. Please request a new OTP code.' }
  }

  if (Date.now() > pending.expiresAt) {
    cookieStore.delete('foodfriends_pending_otp')
    return {
      ok: false,
      error: 'That verification code has expired (10-minute limit). Please click "Resend OTP Code".',
    }
  }

  if (pending.email !== email) {
    return {
      ok: false,
      error: 'The email address changed. Please request a new OTP for this email.',
    }
  }

  const supabase = await createClient()
  const adminDb = createAdminClient()

  // Path A: If sent via Resend custom OTP, verify against customOtpCode and create account
  if (pending.customOtpCode) {
    if (digitsOnly !== pending.customOtpCode) {
      return {
        ok: false,
        error: 'Incorrect OTP code. Please check the code in your email inbox and try again.',
      }
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: pending.email,
        password: pending.password,
        options: {
          data: {
            displayName: pending.displayName,
            ageGroup: pending.ageGroup,
            email_verified_via_otp: true,
          },
        },
      })

      if (error || !data.user) {
        return { ok: false, error: error?.message || 'We could not create that account.' }
      }

      await adminDb.from('profiles').upsert({
        id: data.user.id,
        email: pending.email,
        display_name: pending.displayName,
        age_group: pending.ageGroup,
        points: 0,
        streak: 0,
        is_admin: false,
      })

      cookieStore.delete('foodfriends_pending_otp')
      return {
        ok: true,
        data: {
          id: data.user.id,
          email: data.user.email || pending.email,
          displayName: pending.displayName,
          ageGroup: pending.ageGroup,
          points: 0,
          streak: 0,
          isAdmin: false,
        },
      }
    } catch {
      return { ok: false, error: 'We could not create that account.' }
    }
  }

  // Path B: Verify link token (pkce_...) or numeric OTP sent by Supabase Auth
  let verifiedUserId: string | null = null
  let verifiedUserEmail: string = pending.email
  let lastVerifyError = ''

  if (extractedTokenHash) {
    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^["']|["']$/g, '').trim() ||
      'https://xmmmkqnrzlpomapeyzds.supabase.co'

    // IMPORTANT: Do NOT call verifyOtp({ token_hash }) first on pkce_ tokens because PKCE tokens
    // must be verified via GET /auth/v1/verify and are single-use!
    const candidateTypes = extractedLinkType
      ? [extractedLinkType]
      : ['signup', 'magiclink', 'email']

    for (const linkType of candidateTypes) {
      try {
        const targetUrl =
          fullVerifyUrl && extractedLinkType === linkType
            ? fullVerifyUrl
            : `${supabaseUrl}/auth/v1/verify?token=${encodeURIComponent(
                extractedTokenHash
              )}&type=${encodeURIComponent(linkType)}`

        const verifyRes = await fetch(targetUrl, { redirect: 'manual' })
        const redirectLoc = verifyRes.headers.get('location') || ''

        if (
          (verifyRes.status === 302 || verifyRes.status === 303 || verifyRes.status === 200) &&
          redirectLoc &&
          !redirectLoc.includes('error=')
        ) {
          // 1. Check if redirect Location header contains #access_token=...&refresh_token=... (Implicit Flow)
          const accessMatch = redirectLoc.match(/[?#&]access_token=([^&#\s]+)/)
          const refreshMatch = redirectLoc.match(/[?#&]refresh_token=([^&#\s]+)/)
          if (accessMatch?.[1] && refreshMatch?.[1]) {
            const { data: sessionData } = await supabase.auth.setSession({
              access_token: decodeURIComponent(accessMatch[1]),
              refresh_token: decodeURIComponent(refreshMatch[1]),
            })
            if (sessionData?.user) {
              verifiedUserId = sessionData.user.id
              verifiedUserEmail = sessionData.user.email || pending.email
              break
            }
          }

          // 2. Check if redirect Location header contains ?code=... (PKCE Flow)
          let authCode: string | null = null
          try {
            const locUrl = new URL(redirectLoc, 'http://localhost:3000')
            authCode = locUrl.searchParams.get('code')
          } catch {
            const codeMatch = redirectLoc.match(/[?&]code=([^&#\s]+)/)
            if (codeMatch?.[1]) authCode = decodeURIComponent(codeMatch[1])
          }

          if (authCode) {
            const { data: exchData } = await supabase.auth.exchangeCodeForSession(authCode)
            if (exchData?.user) {
              verifiedUserId = exchData.user.id
              verifiedUserEmail = exchData.user.email || pending.email
              break
            }
          }

          // 3. If token was verified by Supabase without error, complete account creation
          const { data: signUpData } = await supabase.auth.signUp({
            email: pending.email,
            password: pending.password,
            options: {
              data: {
                displayName: pending.displayName,
                ageGroup: pending.ageGroup,
                email_verified_via_otp: true,
              },
            },
          })
          if (signUpData?.user) {
            verifiedUserId = signUpData.user.id
            verifiedUserEmail = signUpData.user.email || pending.email
            break
          }

          const { data: existingProf } = await adminDb
            .from('profiles')
            .select('id')
            .eq('email', pending.email)
            .maybeSingle()
          if (existingProf?.id) {
            verifiedUserId = String(existingProf.id)
            break
          }

          verifiedUserId = crypto.randomUUID()
          break
        } else if (redirectLoc.includes('error_description=')) {
          const descMatch = redirectLoc.match(/error_description=([^&#]+)/)
          if (descMatch?.[1]) {
            lastVerifyError = decodeURIComponent(descMatch[1].replace(/\+/g, ' '))
          }
        }
      } catch {
        // try next candidate type
      }
    }

    // If GET /auth/v1/verify didn't match, try SDK verifyOtp as last resort
    if (!verifiedUserId) {
      for (const otpType of ['signup', 'magiclink', 'email'] as const) {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: extractedTokenHash,
          type: otpType,
        })
        if (!error && data?.user) {
          verifiedUserId = data.user.id
          verifiedUserEmail = data.user.email || pending.email
          break
        }
        if (error) lastVerifyError = error.message
      }
    }
  } else {
    for (const otpType of ['email', 'signup', 'magiclink'] as const) {
      const { data, error } = await supabase.auth.verifyOtp({
        email: pending.email,
        token: digitsOnly,
        type: otpType,
      })
      if (!error && data?.user) {
        verifiedUserId = data.user.id
        verifiedUserEmail = data.user.email || pending.email
        break
      }
      if (error) {
        lastVerifyError = error.message
      }
    }
  }

  if (!verifiedUserId) {
    return {
      ok: false,
      error:
        lastVerifyError ||
        'That email link or code was already used or expired. Click "Resend OTP Code" below for a fresh email!',
    }
  }

  // Save the user's chosen password and metadata onto their verified Supabase Auth account
  try {
    await supabase.auth.updateUser({
      password: pending.password,
      data: {
        displayName: pending.displayName,
        ageGroup: pending.ageGroup,
        email_verified_via_otp: true,
      },
    })
  } catch {
    // ignore if password update is handled separately
  }

  await adminDb.from('profiles').upsert({
    id: verifiedUserId,
    email: verifiedUserEmail,
    display_name: pending.displayName,
    age_group: pending.ageGroup,
    points: 0,
    streak: 0,
    is_admin: false,
  })

  cookieStore.delete('foodfriends_pending_otp')

  return {
    ok: true,
    data: {
      id: verifiedUserId,
      email: verifiedUserEmail,
      displayName: pending.displayName,
      ageGroup: pending.ageGroup,
      points: 0,
      streak: 0,
      isAdmin: false,
    },
  }
}

export async function finalizeEmailHashSessionAction(input: {
  accessToken: string
  refreshToken: string
}): Promise<ActionResult<UserSession | null>> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.setSession({
      access_token: input.accessToken,
      refresh_token: input.refreshToken,
    })
    if (error || !data?.user) {
      return { ok: false, error: error?.message || 'Could not establish session.' }
    }

    const user = data.user
    const cookieStore = await cookies()
    const rawPending = cookieStore.get('foodfriends_pending_otp')?.value

    let displayName = String(user.user_metadata?.displayName || 'Explorer')
    let ageGroup = String(user.user_metadata?.ageGroup || '7-9')

    if (rawPending) {
      try {
        const pending = JSON.parse(rawPending)
        if (pending.displayName) displayName = String(pending.displayName)
        if (pending.ageGroup) ageGroup = String(pending.ageGroup)
        if (pending.password) {
          await supabase.auth.updateUser({
            password: String(pending.password),
            data: {
              displayName,
              ageGroup,
              email_verified_via_otp: true,
            },
          })
        }
      } catch {
        // ignore cookie parse error
      }
      cookieStore.delete('foodfriends_pending_otp')
    }

    const adminDb = createAdminClient()
    await adminDb.from('profiles').upsert({
      id: user.id,
      email: user.email || '',
      display_name: displayName,
      age_group: ageGroup,
      points: 0,
      streak: 0,
      is_admin: false,
    })

    return {
      ok: true,
      data: {
        id: user.id,
        email: user.email || '',
        displayName,
        ageGroup,
        points: 0,
        streak: 0,
        isAdmin: false,
      },
    }
  } catch {
    return { ok: false, error: 'Could not complete email verification.' }
  }
}

export async function exchangeEmailCodeAction(
  code: string
): Promise<ActionResult<UserSession | null>> {
  try {
    const cleanCode = clean(code, 300)
    if (!cleanCode) return { ok: true, data: null }

    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(cleanCode)
    if (error || !data?.user) {
      return { ok: false, error: error?.message || 'Could not verify email link.' }
    }

    const user = data.user
    const cookieStore = await cookies()
    const rawPending = cookieStore.get('foodfriends_pending_otp')?.value

    let displayName = String(user.user_metadata?.displayName || 'Explorer')
    let ageGroup = String(user.user_metadata?.ageGroup || '7-9')

    if (rawPending) {
      try {
        const pending = JSON.parse(rawPending)
        if (pending.displayName) displayName = String(pending.displayName)
        if (pending.ageGroup) ageGroup = String(pending.ageGroup)
        if (pending.password) {
          await supabase.auth.updateUser({
            password: String(pending.password),
            data: {
              displayName,
              ageGroup,
              email_verified_via_otp: true,
            },
          })
        }
      } catch {
        // ignore cookie parse error
      }
      cookieStore.delete('foodfriends_pending_otp')
    }

    const adminDb = createAdminClient()
    await adminDb.from('profiles').upsert({
      id: user.id,
      email: user.email || '',
      display_name: displayName,
      age_group: ageGroup,
      points: 0,
      streak: 0,
      is_admin: false,
    })

    return {
      ok: true,
      data: {
        id: user.id,
        email: user.email || '',
        displayName,
        ageGroup,
        points: 0,
        streak: 0,
        isAdmin: false,
      },
    }
  } catch {
    return { ok: false, error: 'Could not complete email verification.' }
  }
}

export async function signupAction(input: {
  displayName: string
  email: string
  password: string
  ageGroup: string
}): Promise<ActionResult<UserSession>> {
  const displayName = clean(input.displayName, 40)
  const email = clean(input.email, 120).toLowerCase()
  const password = clean(input.password, 128)
  const ageGroup: '4-6' | '7-9' | '10-12' =
    input.ageGroup === '4-6' || input.ageGroup === '10-12' ? input.ageGroup : '7-9'

  if (displayName.length < 2) return { ok: false, error: 'Please add a first name or nickname.' }
  if (!email.includes('@')) return { ok: false, error: 'Please use a valid email.' }
  if (password.length < 6) return { ok: false, error: 'The password needs at least 6 characters.' }

  if (email === DEDICATED_ADMIN_EMAIL) {
    return { ok: false, error: 'That email is reserved for system administration. Please sign in.' }
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          displayName,
          ageGroup,
        },
      },
    })

    if (error || !data.user) {
      return { ok: false, error: error?.message || 'We could not create that account.' }
    }

    const adminDb = createAdminClient()
    await adminDb.from('profiles').upsert({
      id: data.user.id,
      email,
      display_name: displayName,
      age_group: ageGroup,
      points: 0,
      streak: 0,
      is_admin: false,
    })

    return {
      ok: true,
      data: {
        id: data.user.id,
        email: data.user.email || '',
        displayName,
        ageGroup,
        points: 0,
        streak: 0,
        isAdmin: false,
      },
    }
  } catch {
    return { ok: false, error: 'We could not create that account. The email may already be used.' }
  }
}

export async function logoutAction(): Promise<ActionResult<null>> {
  const cookieStore = await cookies()
  cookieStore.delete('foodfriends_admin_session')
  const supabase = await createClient()
  await supabase.auth.signOut()
  return { ok: true, data: null }
}

export async function saveScanAction(input: {
  foodName: string
  foodGroup: FoodGroup
  score: number
  summary: string
  imageDataUrl?: string
}): Promise<ActionResult<{ id: string; points: number; streak: number }>> {
  const cookieStore = await cookies()
  const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isAdminCookie) {
    return { ok: false, error: 'Sign in to save this scan to your explorer log.' }
  }

  const foodName = clean(input.foodName, 80)
  const summary = clean(input.summary, 180)
  const groups: FoodGroup[] = ['fruit', 'vegetable', 'protein', 'grain', 'dairy', 'treat']
  const score = Math.round(Number(input.score))
  if (!foodName || !summary || !groups.includes(input.foodGroup) || score < 1 || score > 100) {
    return { ok: false, error: 'That scan result could not be saved.' }
  }

  const storedSummary =
    input.imageDataUrl && input.imageDataUrl.startsWith('data:image/')
      ? `${summary}\n||IMG||${input.imageDataUrl}`
      : summary

  try {
    const adminDb = createAdminClient()
    const { data, error } = await adminDb
      .from('food_logs')
      .insert({
        user_id: user?.id ?? null,
        food_name: foodName,
        food_group: input.foodGroup,
        score,
        summary: storedSummary,
      })
      .select('id')
      .single()

    if (error) {
      return { ok: false, error: error.message || 'We could not save the scan right now.' }
    }

    const accurateStats = await fetchAccurateUserStats(user?.id ?? null)

    return {
      ok: true,
      data: { id: data.id, points: accurateStats.points, streak: accurateStats.streak },
    }
  } catch {
    return { ok: false, error: 'We could not save the scan right now.' }
  }
}

// ==========================================
// AI FOOD ANALYSIS WITH GEMINI VISION
// ==========================================

export type FoodNutrients = {
  calories: string
  protein: string
  carbs: string
  fat: string
  fiber: string
  sugar: string
  vitamins: string[]
  minerals: string[]
}

export type FoodAnalysis = {
  name: string
  group: FoodGroup
  estimatedPortion: string
  score: number
  summary: string
  color: string
  explanation: string
  nutrients: FoodNutrients
  funFact: string
  tip: string
}

const GROUP_COLORS: Record<FoodGroup, string> = {
  fruit: '#E45B4E',
  vegetable: '#65A968',
  protein: '#E99D55',
  grain: '#C89A5D',
  dairy: '#81A8D9',
  treat: '#D97984',
}

const FOOD_ANALYSIS_PROMPT = `You are Bananini 🍌, the world's best food detective and kid mascot for FoodFriends.

Examine this photo very carefully.

STEP 1 — STRICT FOOD VERIFICATION:
First, determine whether the photo actually contains real edible human food or a beverage.
- If the image shows something that is NOT edible food or a drink (for example: a person, selfie, face, hand without food, pet/animal, laptop, phone, screen, toy, furniture, room, wall, paper, car, clothing, or blurry/empty background), you MUST reject it and return ONLY this JSON object:
{
  "isFood": false,
  "nonFoodReason": "Short friendly message telling the user what you see instead of food (e.g. 'That looks like a laptop, not a meal! Please scan real food or a drink.')"
}

STEP 2 — IF AND ONLY IF IT IS REAL FOOD OR A DRINK:
1. Identify the food accurately based ONLY on what you see in the photo (e.g. if you see pancakes, it is Pancakes/Grain; if you see an apple, it is Apple/Fruit; if you see chicken nuggets, it is Protein/Treat).
2. ESTIMATE THE QUANTITY / PORTION SHOWN IN THE PHOTO (e.g. "Stack of 5 pancakes (~220g)", "1 medium apple (~150g)", "Bowl of cereal with milk (~250ml)").
3. CALCULATE THE NUTRITION FACTS SCALED SPECIFICALLY TO THAT VISIBLE QUANTITY (e.g. if there are 5 pancakes, calculate calories and protein for all 5 pancakes, not just 1 small bite!).

Return ONLY a valid raw JSON object (no markdown, no backticks, no fences, no comments) with this exact structure:
{
  "isFood": true,
  "name": "Food name (e.g. Golden Fluffy Pancakes)",
  "group": "grain",
  "estimatedPortion": "e.g. Stack of 5 fluffy pancakes (~220g)",
  "score": 75,
  "summary": "Short 1-sentence kid-friendly summary of this food",
  "explanation": "2-3 kid-friendly sentences explaining how this food fuels the body, muscles, or brain",
  "nutrients": {
    "calories": "Total calories for the estimated portion, e.g. '450 kcal'",
    "protein": "e.g. '9g'",
    "carbs": "e.g. '75g'",
    "fat": "e.g. '12g'",
    "fiber": "e.g. '3.2g'",
    "sugar": "e.g. '14g'",
    "vitamins": ["Vitamin B1 (Thiamine)", "Vitamin B2 (Riboflavin)", "Folate"],
    "minerals": ["Calcium", "Iron", "Phosphorus"]
  },
  "funFact": "A fun, surprising fact about this food that kids will love",
  "tip": "A healthy eating tip (e.g. Top with fresh berries or sliced bananas for natural fiber!)"
}

FOOD GROUP CLASSIFICATION RULES:
- "fruit": fresh, dried, or frozen fruits (apple, banana, berries, orange, mango)
- "vegetable": broccoli, carrots, spinach, salad, peas, peppers, squash
- "protein": chicken, meat, fish, eggs, beans, nuts, seeds, tofu
- "grain": pancakes, waffles, bread, rice, pasta, oatmeal, cereal, tortillas, corn
- "dairy": milk, cheese, yogurt
- "treat": candy, cookies, soda, potato chips, cake, ice cream, deep-fried snacks

CRITICAL:
- If the image is NOT food or a beverage, "isFood" MUST be false.
- When "isFood" is true, "group" MUST be exactly one of: "fruit", "vegetable", "protein", "grain", "dairy", "treat"
- Pancakes and waffles MUST be classified as "grain" (or "treat" if coated in chocolate/sprinkles), NEVER as "fruit"
- Return ONLY the raw JSON string.`

export async function analyzeFoodAction(
  imageBase64: string,
  mimeType: string
): Promise<ActionResult<FoodAnalysis>> {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
      return {
        ok: false,
        error: 'Gemini API key not configured. Add GEMINI_API_KEY to your environment.',
      }
    }

    const ai = new GoogleGenAI({ apiKey })

    // Clean base64 string - strip data URL header if present
    const cleanBase64 = imageBase64.includes(',')
      ? imageBase64.split(',')[1]
      : imageBase64

    // Model candidate list in priority order
    const candidateModels = [
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.8-flash',
    ]

    let responseText = ''
    let lastError = ''

    for (const model of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { text: FOOD_ANALYSIS_PROMPT },
                {
                  inlineData: {
                    mimeType: mimeType || 'image/jpeg',
                    data: cleanBase64,
                  },
                },
              ],
            },
          ],
        })

        if (response.text) {
          responseText = response.text.trim()
          break
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        console.warn(`Vision model ${model} failed, trying next:`, lastError)
      }
    }

    if (!responseText) {
      console.error('All vision models failed. Last error:', lastError)
      return { ok: false, error: 'Could not connect to AI vision model. Please try again.' }
    }

    // Strip markdown code fences if present
    const jsonStr = responseText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim()

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      // Try extracting json block with regex
      const match = jsonStr.match(/\{[\s\S]*\}/)
      if (match) {
        parsed = JSON.parse(match[0])
      } else {
        return { ok: false, error: 'Bananini got confused! Try taking a clearer photo of your food.' }
      }
    }

    const rawName = String(parsed.name || '').trim()
    const rawNameLower = rawName.toLowerCase()
    if (
      parsed.isFood === false ||
      rawNameLower === 'not food' ||
      rawNameLower === 'non-food' ||
      rawNameLower === 'none' ||
      rawNameLower === 'unknown'
    ) {
      const reason = String(
        parsed.nonFoodReason ||
          "That doesn't look like food! Please take or upload a clear photo of real food or a drink."
      ).trim()
      return {
        ok: false,
        error: `🚫 Not Food Detected: ${reason}`,
      }
    }

    const validGroups: FoodGroup[] = ['fruit', 'vegetable', 'protein', 'grain', 'dairy', 'treat']
    let group = validGroups.includes(parsed.group as FoodGroup)
      ? (parsed.group as FoodGroup)
      : 'grain'

    const foodNameLower = String(parsed.name || '').toLowerCase()
    if (foodNameLower.includes('pancake') || foodNameLower.includes('waffle')) {
      group = 'grain'
    }

    const nutrients = parsed.nutrients as Record<string, unknown> | undefined

    const analysis: FoodAnalysis = {
      name: String(parsed.name || 'Delicious Food'),
      group,
      estimatedPortion: String(
        parsed.estimatedPortion || 'Estimated from photo: 1 typical serving'
      ),
      score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 75))),
      summary: String(parsed.summary || 'Bananini inspected your delicious food!'),
      color: GROUP_COLORS[group],
      explanation: String(parsed.explanation || ''),
      nutrients: {
        calories: String(nutrients?.calories || '—'),
        protein: String(nutrients?.protein || '—'),
        carbs: String(nutrients?.carbs || '—'),
        fat: String(nutrients?.fat || '—'),
        fiber: String(nutrients?.fiber || '—'),
        sugar: String(nutrients?.sugar || '—'),
        vitamins: Array.isArray(nutrients?.vitamins)
          ? (nutrients.vitamins as string[]).map(String)
          : [],
        minerals: Array.isArray(nutrients?.minerals)
          ? (nutrients.minerals as string[]).map(String)
          : [],
      },
      funFact: String(parsed.funFact || ''),
      tip: String(parsed.tip || ''),
    }

    return { ok: true, data: analysis }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Analysis failed'
    console.error('Food analysis error:', msg)
    return { ok: false, error: 'Oops! Bananini had trouble analyzing that photo. Try again!' }
  }
}

export type FoodLogItem = {
  id: string
  user_id?: string
  food_name: string
  food_group: FoodGroup
  score: number
  summary: string
  image_url?: string
  created_at: string
}

function parseFoodLogRow(row: Record<string, unknown>): FoodLogItem {
  const rawSummary = String(row.summary || '')
  const [cleanSummary, embeddedImage] = rawSummary.split('\n||IMG||')
  return {
    id: String(row.id || ''),
    user_id: row.user_id ? String(row.user_id) : undefined,
    food_name: String(row.food_name || ''),
    food_group: (row.food_group as FoodGroup) || 'fruit',
    score: Number(row.score || 0),
    summary: cleanSummary,
    image_url: embeddedImage || undefined,
    created_at: String(row.created_at || ''),
  }
}

export async function getFoodLogsAction(): Promise<ActionResult<FoodLogItem[]>> {
  try {
    const cookieStore = await cookies()
    const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user && !isAdminCookie) return { ok: true, data: [] }

    const adminDb = createAdminClient()
    let query = adminDb
      .from('food_logs')
      .select('id, user_id, food_name, food_group, score, summary, created_at')
      .neq('id', '00000000-0000-0000-0000-000000000b17')
      .neq('food_name', 'BrainBitesConfig')
      .neq('food_group', '__brain_bites__')
      .order('created_at', { ascending: false })
      .limit(50)

    if (user?.id) {
      query = query.eq('user_id', user.id)
    }

    const { data, error } = await query

    if (error) return { ok: false, error: error.message }
    return {
      ok: true,
      data: (data || []).map((row) => parseFoodLogRow(row as Record<string, unknown>)),
    }
  } catch {
    return { ok: true, data: [] }
  }
}

export async function deleteUserFoodLogAction(
  logId: string
): Promise<ActionResult<{ points: number; streak: number }>> {
  try {
    if (!logId) return { ok: false, error: 'Invalid food log ID.' }

    const cookieStore = await cookies()
    const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user && !isAdminCookie) {
      return { ok: false, error: 'Please sign in to delete items from your Explorer Log.' }
    }

    const adminDb = createAdminClient()
    let query = adminDb.from('food_logs').delete().eq('id', logId)

    // Regular users can only delete their own logs; System Admin can delete any log in their view
    if (user?.id && !isAdminCookie) {
      query = query.eq('user_id', user.id)
    }

    const { error } = await query
    if (error) return { ok: false, error: error.message }

    const accurateStats = await fetchAccurateUserStats(user?.id ?? null)
    return { ok: true, data: accurateStats }
  } catch (err: unknown) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Could not delete food log.',
    }
  }
}

// ==========================================
// ASK BANANINI AI CHAT ACTION
// ==========================================

export async function askBananiniAction(
  question: string,
  options?: {
    history?: { from: 'bot' | 'user'; text: string }[]
    scannedFood?: FoodAnalysis | null
  }
): Promise<ActionResult<string>> {
  const cleanQ = clean(question, 1000)
  if (!cleanQ) return { ok: false, error: 'Please enter a question.' }

  const cookieStore = await cookies()
  const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isAdminCookie) {
    return { ok: false, error: 'Please sign in to chat with Bananini.' }
  }

  const fallbackResponses = (q: string): string => {
    const l = q.toLowerCase()
    if (l.includes('snack') || l.includes('meryenda'))
      return '🍌 Try a power pair: fresh fruit plus creamy yogurt, whole-grain crackers plus cheese, or crisp apple slices with peanut or seed butter!'
    if (l.includes('vegetable') || l.includes('veggie') || l.includes('gulay'))
      return '🥦 Start tiny and make it fun! Try one crunchy bite with a favorite dip, and keep exploring without pressure. Every color is a new superpower!'
    if (l.includes('sugar') || l.includes('candy') || l.includes('chocolate') || l.includes('matamis'))
      return '🧁 Sweet treats are "sometimes foods"! Enjoy a small portion with a smile, then choose fresh water and a colorful fruit for your next energy boost.'
    if (l.includes('breakfast') || l.includes('almusal'))
      return '☀️ A champion breakfast combines a steady grain, a protein helper, and a fruit — like oatmeal or pancakes topped with yogurt and fresh berries!'
    if (l.includes('water') || l.includes('drink') || l.includes('tubig'))
      return '💧 Water is your ultimate body fuel! It hydrates your brain, speeds up your thinking, and keeps muscles ready to jump and play.'
    return '🌟 Bananini’s golden rule: add color to your plate, include a protein helper, and drink plenty of fresh water! Always check with a grown-up about allergies.'
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (!apiKey) {
      return { ok: true, data: fallbackResponses(cleanQ) }
    }

    const ai = new GoogleGenAI({ apiKey })

    const scannedContext = options?.scannedFood
      ? `\nCURRENTLY SCANNED FOOD IN USER'S SCANNER:
- Food Name: ${options.scannedFood.name}
- Category: ${options.scannedFood.group}
- Estimated Portion in Photo: ${options.scannedFood.estimatedPortion || '1 typical serving'}
- Health Score: ${options.scannedFood.score}/100
- Nutrition for this portion: ${options.scannedFood.nutrients.calories} calories, ${options.scannedFood.nutrients.protein} protein, ${options.scannedFood.nutrients.carbs} carbs, ${options.scannedFood.nutrients.fiber} fiber, ${options.scannedFood.nutrients.fat} fat, ${options.scannedFood.nutrients.sugar} sugar
- Key Micronutrients: ${options.scannedFood.nutrients.vitamins.join(', ')}
- Summary: ${options.scannedFood.summary}\n`
      : ''

    const recentHistory = (options?.history || [])
      .slice(-8)
      .map((msg) => `${msg.from === 'user' ? 'Explorer' : 'Bananini'}: ${msg.text}`)
      .join('\n')

    const historyContext = recentHistory
      ? `\nRECENT CONVERSATION HISTORY:\n${recentHistory}\n`
      : ''

    const promptText = `You are Bananini 🍌, the lovable, smart, and enthusiastic monkey nutritionist mascot in the FoodFriends Scanner App.
You help kids, parents, and curious food explorers understand nutrition, food superpowers, healthy swaps, portion sizes, and fun meal ideas.

RULES:
- Answer clearly in 2-4 friendly sentences.
- Match the user's language naturally! If they ask in Tagalog or Taglish, reply warmly in Tagalog/Taglish. If they ask in English, reply in English.
- Do NOT use markdown formatting like **bold** or *italics* or # headers — write clean plain text with fun emojis (🍌, 🍎, 🥦, ⚡, 🌟, 🥞, 💪).
- If the user asks about their scanned food (or says "it", "ito", "this food"), use the CURRENTLY SCANNED FOOD details below to give specific, accurate nutrition and portion insights.
- Use positive food concepts like "everyday foods" (veggies, fruits, whole grains, proteins, dairy) and "sometimes foods" (sweets, fried treats). Never shame any food.
${scannedContext}${historyContext}
Explorer's new question: "${cleanQ}"`

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash']
    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              role: 'user',
              parts: [{ text: promptText }],
            },
          ],
        })
        const reply = response.text?.replace(/\*\*/g, '').replace(/\*/g, '').trim()
        if (reply) {
          return { ok: true, data: reply }
        }
      } catch (err) {
        console.warn(`Bananini chat model ${modelName} error:`, err instanceof Error ? err.message : err)
      }
    }

    return { ok: true, data: fallbackResponses(cleanQ) }
  } catch {
    return { ok: true, data: fallbackResponses(cleanQ) }
  }
}

// ==========================================
// ADMIN MANAGEMENT ACTIONS
// ==========================================

export type AdminProfileItem = {
  id: string
  email: string
  display_name: string
  age_group: string
  points: number
  streak: number
  is_admin: boolean
  created_at: string
}

export type AdminDashboardData = {
  totalUsers: number
  totalScans: number
  users: AdminProfileItem[]
  scans: FoodLogItem[]
}

// Check admin permission helper
async function verifyAdmin(): Promise<boolean> {
  const cookieStore = await cookies()
  if (cookieStore.get('foodfriends_admin_session')?.value === 'true') {
    return true
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  if (user.email === DEDICATED_ADMIN_EMAIL) return true

  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .single()

  return Boolean(profile?.is_admin)
}

// 1. View how many people signed up + detailed list
export async function adminGetDashboardDataAction(): Promise<ActionResult<AdminDashboardData>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) {
      return { ok: false, error: 'Unauthorized: Admin privileges required.' }
    }

    const supabase = createAdminClient()

    const [usersRes, scansRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false }),
      supabase
        .from('food_logs')
        .select('*', { count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000b17')
        .neq('food_name', 'BrainBitesConfig')
        .neq('food_group', '__brain_bites__')
        .order('created_at', { ascending: false })
        .limit(500),
    ])

    let usersData = usersRes.data as AdminProfileItem[] | null
    let userCount = usersRes.count

    if (usersRes.error) {
      const fallbackUsers = await supabase.from('profiles').select('*', { count: 'exact' })
      if (fallbackUsers.error) {
        return { ok: false, error: `Database error (profiles): ${fallbackUsers.error.message}` }
      }
      usersData = fallbackUsers.data as AdminProfileItem[] | null
      userCount = fallbackUsers.count
    }

    let scansData = scansRes.data as Record<string, unknown>[] | null
    let scanCount = scansRes.count

    if (scansRes.error) {
      const fallbackScans = await supabase
        .from('food_logs')
        .select('*', { count: 'exact' })
        .neq('id', '00000000-0000-0000-0000-000000000b17')
        .neq('food_name', 'BrainBitesConfig')
        .neq('food_group', '__brain_bites__')
        .limit(500)
      if (fallbackScans.error) {
        return { ok: false, error: `Database error (food_logs): ${fallbackScans.error.message}` }
      }
      scansData = fallbackScans.data as Record<string, unknown>[] | null
      scanCount = fallbackScans.count
    }

    const parsedScans = (scansData || []).map((row) => parseFoodLogRow(row))
    const normalizedUsers: AdminProfileItem[] = (usersData || []).map((u) => {
      const userLogs = parsedScans.filter((s) => s.user_id === u.id)
      const calc = calculateAccuratePointsAndStreak(userLogs.map((s) => s.created_at))
      // Reset old hardcoded 120/9999 defaults if user has 0 scans, while keeping any admin bonus points
      const rawPoints = typeof u.points === 'number' ? u.points : 0
      const effectivePoints =
        userLogs.length === 0 && (rawPoints === 120 || rawPoints === 9999)
          ? 0
          : Math.max(rawPoints, calc.points)

      return {
        id: String(u.id),
        email: String(u.email || 'no-email@foodfriends.com'),
        display_name: String(u.display_name || 'Explorer'),
        age_group: String(u.age_group || '7-9'),
        points: effectivePoints,
        streak: calc.streak,
        is_admin: Boolean(u.is_admin),
        created_at: String(u.created_at || new Date().toISOString()),
      }
    })

    return {
      ok: true,
      data: {
        totalUsers: userCount ?? normalizedUsers.length,
        totalScans: scanCount ?? parsedScans.length,
        users: normalizedUsers,
        scans: parsedScans,
      },
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch admin data.'
    return { ok: false, error: msg }
  }
}

export async function generateAnalyticsInsightAction(summaryStats: {
  totalScans: number
  avgScore: number
  groupBreakdown: { label: string; count: number; pct: number }[]
  topFoods: string[]
}): Promise<ActionResult<string>> {
  try {
    const cookieStore = await cookies()
    const isAdminCookie = cookieStore.get('foodfriends_admin_session')?.value === 'true'
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user && !isAdminCookie) {
      return { ok: false, error: 'Please sign in to generate AI nutrition insights.' }
    }

    if (summaryStats.totalScans === 0) {
      return {
        ok: true,
        data: 'No scans recorded yet. Encourage explorers to scan their daily meals to generate AI nutrition insights!',
      }
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    const breakdownStr = summaryStats.groupBreakdown
      .map((g) => `${g.label}: ${g.count} scans (${g.pct}%)`)
      .join(', ')

    const fallback = `📊 Based on ${summaryStats.totalScans} logged scans with an average health score of ${summaryStats.avgScore}/100, explorers are actively tracking their meals (${breakdownStr}). Encourage more variety across underrepresented food groups like vegetables and proteins to complete the 6-group rainbow plate!`

    if (!apiKey) return { ok: true, data: fallback }

    const ai = new GoogleGenAI({ apiKey })
    const prompt = `You are Bananini's Nutrition Intelligence Analyst for the FoodFriends Scanner App.
Analyze the following food scan metrics and provide a concise, actionable 3-sentence summary (plain text, no markdown asterisks **):
- Total Scans: ${summaryStats.totalScans}
- Average Health Score: ${summaryStats.avgScore}/100
- Category Breakdown: ${breakdownStr}
- Top Scanned Foods: ${summaryStats.topFoods.join(', ') || 'N/A'}

Highlight what food groups are strong, which food groups are missing or low, and 1 fun recommendation to improve overall nutrition balance.`

    const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash']
    for (const modelName of modelsToTry) {
      try {
        const res = await ai.models.generateContent({
          model: modelName,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
        })
        const text = res.text?.replace(/\*\*/g, '').replace(/\*/g, '').trim()
        if (text) return { ok: true, data: text }
      } catch {
        // try next model
      }
    }

    return { ok: true, data: fallback }
  } catch {
    return {
      ok: false,
      error: 'Could not generate AI insights right now.',
    }
  }
}

// 2. Delete inappropriate food scans or test data
export async function adminDeleteFoodLogAction(scanId: string): Promise<ActionResult<null>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const supabase = createAdminClient()
    const { error } = await supabase.from('food_logs').delete().eq('id', scanId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: null }
  } catch {
    return { ok: false, error: 'Failed to delete scan.' }
  }
}

export async function adminDeleteUserAction(targetUserId: string): Promise<ActionResult<null>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const supabase = createAdminClient()
    await supabase.from('food_logs').delete().eq('user_id', targetUserId)
    const { error } = await supabase.from('profiles').delete().eq('id', targetUserId)
    if (error) return { ok: false, error: error.message }
    return { ok: true, data: null }
  } catch {
    return { ok: false, error: 'Failed to delete user profile.' }
  }
}

// 3. Reset someone's password if they ask for help
export async function adminResetUserPasswordAction(
  targetEmail: string
): Promise<ActionResult<string>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const cleanEmail = targetEmail.trim().toLowerCase()
    const supabase = createAdminClient()
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail)

    if (error) {
      return { ok: false, error: error.message }
    }

    return {
      ok: true,
      data: `Password reset request dispatched to ${cleanEmail}. An email with instructions was sent.`,
    }
  } catch {
    return { ok: false, error: 'Failed to initiate password reset.' }
  }
}

// 4. Inspect the database without writing code
export async function adminInspectTableAction(
  tableName: 'profiles' | 'food_logs'
): Promise<ActionResult<{ columns: string[]; rows: Record<string, unknown>[] }>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const supabase = createAdminClient()
    let query = supabase
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

    if (tableName === 'food_logs') {
      query = query
        .neq('id', '00000000-0000-0000-0000-000000000b17')
        .neq('food_name', 'BrainBitesConfig')
        .neq('food_group', '__brain_bites__')
    }

    const { data, error } = await query

    if (error) return { ok: false, error: error.message }

    const rawRows = (data as Record<string, unknown>[]) || []
    const rows = rawRows.map((row) => {
      if (tableName === 'food_logs' && typeof row.summary === 'string') {
        const parsed = parseFoodLogRow(row)
        return {
          ...row,
          summary: parsed.summary,
          photo_attached: parsed.image_url ? '✅ Yes' : 'No',
        }
      }
      return row
    })
    const columns = rows.length > 0 ? Object.keys(rows[0]) : []

    return { ok: true, data: { columns, rows } }
  } catch {
    return { ok: false, error: 'Failed to inspect database table.' }
  }
}

// Points and role adjustments
export async function adminUpdateUserPointsAction(
  userId: string,
  newPoints: number
): Promise<ActionResult<null>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('profiles')
      .update({ points: Math.max(0, Math.round(newPoints)) })
      .eq('id', userId)

    if (error) return { ok: false, error: error.message }
    return { ok: true, data: null }
  } catch {
    return { ok: false, error: 'Failed to update points.' }
  }
}

export async function adminToggleAdminStatusAction(
  targetUserId: string,
  isAdmin: boolean
): Promise<ActionResult<null>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from('profiles')
      .update({ is_admin: isAdmin })
      .eq('id', targetUserId)

    if (error) return { ok: false, error: error.message }
    return { ok: true, data: null }
  } catch {
    return { ok: false, error: 'Failed to change admin role.' }
  }
}

// 5. System Announcement & Bananini Daily Message
let systemAnnouncement = {
  quote: 'Every color is a new power!',
  bannerText: '🥦 Healthy Food Week: Scan an apple or broccoli today for bonus explorer points!',
  showBanner: true,
}

export async function getAnnouncementAction(): Promise<
  ActionResult<{ quote: string; bannerText: string; showBanner: boolean }>
> {
  return { ok: true, data: systemAnnouncement }
}

export async function adminUpdateAnnouncementAction(input: {
  quote: string
  bannerText: string
  showBanner: boolean
}): Promise<ActionResult<{ quote: string; bannerText: string; showBanner: boolean }>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    systemAnnouncement = {
      quote: clean(input.quote, 140) || 'Every color is a new power!',
      bannerText: clean(input.bannerText, 200),
      showBanner: Boolean(input.showBanner),
    }

    return { ok: true, data: systemAnnouncement }
  } catch {
    return { ok: false, error: 'Failed to update announcement.' }
  }
}

// ==========================================
// 6. LEARN & PLAY: BANANINI'S BRAIN BITES MANAGER
// ==========================================

export type BrainBitesQuestion = {
  id: string
  q: string
  options: string[]
  answer: number
  note: string
  category?: string
}

export type BrainBitesData = {
  questions: BrainBitesQuestion[]
  deletedQuestionIds?: string[]
  miniChallenge: {
    title: string
    description: string
    cta: string
  }
  didYouKnow: {
    title: string
    fact: string
  }
}

const BRAIN_BITES_ROW_ID = '00000000-0000-0000-0000-000000000b17'
const BRAIN_BITES_CONFIG_NAME = 'BrainBitesConfig'

const DEFAULT_BRAIN_BITES: BrainBitesData = {
  questions: [
    {
      id: 'q1',
      q: 'Which snack gives you long-lasting energy for school and play?',
      options: ['Apple slices & peanut butter', 'Gummy candy', 'Fizzy soda drink'],
      answer: 0,
      note: 'Fruit plus protein is a power-team for steady energy that lasts for hours!',
      category: 'fruit',
    },
    {
      id: 'q2',
      q: "Why do we call a healthy meal a 'Rainbow Plate'?",
      options: [
        'Different food colors give different vitamins',
        'The plate is painted like a rainbow',
        'It only has skittles on it',
      ],
      answer: 0,
      note: 'Red, orange, green, purple, and white whole foods each carry unique nutrients!',
      category: 'habits',
    },
    {
      id: 'q3',
      q: 'What is the best everyday drink for your brain and muscles?',
      options: ['Fresh water', 'Sugary soda', 'Energy drink'],
      answer: 0,
      note: 'Water hydrates your body and brain so you can run fast and think clearly.',
      category: 'dairy',
    },
    {
      id: 'q4',
      q: 'Which mineral in milk, cheese, and yogurt builds strong bones and teeth?',
      options: ['Calcium', 'Added sugar', 'Food coloring'],
      answer: 0,
      note: 'Calcium teams up with Vitamin D to make your growing bones and teeth super strong!',
      category: 'dairy',
    },
    {
      id: 'q5',
      q: 'What superpower do orange veggies like carrots and sweet potatoes have?',
      options: ['Vitamin A for sharp eyes', 'Making you sleepy', 'Turning your hair blue'],
      answer: 0,
      note: 'Orange veggies are rich in beta-carotene (Vitamin A), which helps your eyes see clearly!',
      category: 'vegetable',
    },
    {
      id: 'q6',
      q: 'Why are whole grains like oatmeal and brown rice great for breakfast?',
      options: ['Slow-release fiber & brain fuel', 'They have zero nutrients', 'They replace water'],
      answer: 0,
      note: 'Whole grains have fiber and B-vitamins that fuel your brain all morning long!',
      category: 'grain',
    },
    {
      id: 'q7',
      q: 'Which vitamin in oranges, strawberries, and bell peppers helps fight off colds?',
      options: ['Vitamin C', 'Refined salt', 'Cooking oil'],
      answer: 0,
      note: 'Vitamin C is an immune-system superhero that helps your body heal and stay healthy!',
      category: 'fruit',
    },
    {
      id: 'q8',
      q: 'Which food group acts like building blocks to repair and grow your muscles?',
      options: ['Proteins like eggs, chicken, fish, and beans', 'Hard candies', 'Potato chips'],
      answer: 0,
      note: 'Proteins are made of amino acids that build strong muscles and help you grow taller!',
      category: 'protein',
    },
    {
      id: 'q9',
      q: 'What helpful nutrient in apples, berries, and broccoli keeps your tummy happy?',
      options: ['Dietary fiber', 'Artificial dye', 'Extra frosting'],
      answer: 0,
      note: 'Fiber helps your digestion work smoothly and keeps you feeling full and satisfied!',
      category: 'fruit',
    },
    {
      id: 'q10',
      q: "Why are blueberries and purple grapes called 'Brain Berries'?",
      options: [
        'Their antioxidants help memory and focus',
        'They make your tongue glow',
        'They are shaped like brains',
      ],
      answer: 0,
      note: 'Blue and purple fruits contain anthocyanins that protect brain cells and boost memory!',
      category: 'fruit',
    },
    {
      id: 'q11',
      q: 'What mineral in spinach, lentils, and lean meat helps carry oxygen in your blood?',
      options: ['Iron', 'Plastic', 'Helium'],
      answer: 0,
      note: "Iron carries fresh oxygen from your lungs to your muscles and brain so you don't feel tired!",
      category: 'vegetable',
    },
    {
      id: 'q12',
      q: 'Which nutrient in bananas helps stop muscle cramps when you run and play?',
      options: ['Potassium', 'Melted butter', 'Caramel'],
      answer: 0,
      note: 'Bananas are famous for potassium, an electrolyte mineral that keeps muscles and hearts happy!',
      category: 'fruit',
    },
    {
      id: 'q13',
      q: 'What are the friendly tiny helpers inside yogurt that help your digestion?',
      options: ['Probiotics', 'Fizzy bubbles', 'Sprinkles'],
      answer: 0,
      note: 'Probiotics are friendly good bacteria that live in your tummy and help digest food!',
      category: 'dairy',
    },
    {
      id: 'q14',
      q: 'Which of these is a plant-based protein superhero?',
      options: ['Beans, lentils, and tofu', 'Cotton candy', 'Lollipops'],
      answer: 0,
      note: 'Beans, lentils, chickpeas, nuts, and tofu pack awesome protein plus tummy-friendly fiber!',
      category: 'protein',
    },
    {
      id: 'q15',
      q: "How much of your brain's daily energy comes from the food you eat?",
      options: [
        'About 20% (one-fifth of your energy!)',
        "0% — brains don't need food",
        '100% — muscles use none',
      ],
      answer: 0,
      note: "Your brain is always thinking and learning, so it uses about 20% of all your body's fuel!",
      category: 'habits',
    },
    {
      id: 'q16',
      q: 'Why is it better to eat a whole orange instead of drinking orange-flavored soda?',
      options: [
        'Real fruit has natural fiber and Vitamin C without extra sugar',
        'Oranges are louder to chew',
        'Soda has too many seeds',
      ],
      answer: 0,
      note: 'Whole fruits keep their natural fiber and vitamins, giving you smooth energy without a sugar crash!',
      category: 'fruit',
    },
    {
      id: 'q17',
      q: 'Which green vegetable looks like a tiny tree and has more Vitamin C per gram than an orange?',
      options: ['Broccoli', 'Iceberg lettuce', 'Celery'],
      answer: 0,
      note: 'Broccoli florets look like little trees and are packed with Vitamin C, Vitamin K, and fiber!',
      category: 'vegetable',
    },
    {
      id: 'q18',
      q: 'What do red fruits and veggies like tomatoes and watermelon have that helps your heart?',
      options: ['Lycopene', 'Maple syrup', 'Baking soda'],
      answer: 0,
      note: 'Lycopene gives tomatoes and watermelons their bright red color and helps keep your heart strong!',
      category: 'vegetable',
    },
    {
      id: 'q19',
      q: "Which vitamin works as Calcium's best friend to help your bones absorb strength?",
      options: ['Vitamin D (the sunshine vitamin!)', 'Corn syrup', 'Black pepper'],
      answer: 0,
      note: 'Vitamin D from fortified milk, eggs, fish, and safe sunshine helps calcium lock into your bones!',
      category: 'dairy',
    },
    {
      id: 'q20',
      q: "What happens when you eat 'sometimes treats' like cookies or candy on an empty stomach?",
      options: [
        'A quick sugar spike followed by a sleepy crash',
        'Instant super-strength for 10 hours',
        'You grow two inches taller',
      ],
      answer: 0,
      note: 'Sugary treats burn up super fast! Pairing snacks with protein or fiber keeps your energy steady.',
      category: 'habits',
    },
    {
      id: 'q21',
      q: "Which fish nutrient is famous for helping kids' brains and eyes grow super sharp?",
      options: ['Omega-3 healthy fats', 'Table salt', 'Breadcrumbs'],
      answer: 0,
      note: 'Salmon, tuna, and sardines have Omega-3 fatty acids that build healthy brain connections!',
      category: 'protein',
    },
    {
      id: 'q22',
      q: 'Which of these snacks is a whole grain?',
      options: ['Air-popped popcorn or oatmeal', 'Gummy bears', 'Potato crisps'],
      answer: 0,
      note: 'Popcorn is actually a whole grain corn kernel! Lightly seasoned popcorn has plenty of fiber.',
      category: 'grain',
    },
    {
      id: 'q23',
      q: 'Why does chewing your food slowly help your body?',
      options: [
        "It helps your tummy digest nutrients easily and notice when you're full",
        'It makes food colder',
        'It turns veggies into cake',
      ],
      answer: 0,
      note: 'Digestion starts in your mouth! Chewing well helps your stomach unlock every vitamin.',
      category: 'habits',
    },
    {
      id: 'q24',
      q: 'Which fruit is about 92% water and helps keep you hydrated on a hot sunny day?',
      options: ['Watermelon', 'Dried raisins', 'Banana chips'],
      answer: 0,
      note: 'Watermelon, strawberries, and cucumbers are packed with refreshing water and vitamins!',
      category: 'fruit',
    },
    {
      id: 'q25',
      q: 'What vitamin in leafy greens like spinach and kale helps your skin heal when you get a scrape?',
      options: ['Vitamin K', 'Chocolate syrup', 'Vinegar'],
      answer: 0,
      note: 'Vitamin K helps your blood clot when you get a tiny scrape so your skin can heal fast!',
      category: 'vegetable',
    },
    {
      id: 'q26',
      q: 'What is a smart way to build a balanced plate for lunch or dinner?',
      options: [
        'Half fruits & veggies, a quarter whole grains, and a quarter protein',
        'All french fries and ketchup',
        'Only dessert first',
      ],
      answer: 0,
      note: 'Filling half your plate with colorful fruits and veggies gives you vitamins, fiber, and steady energy!',
      category: 'habits',
    },
    {
      id: 'q27',
      q: 'Which of these breakfast foods gives you strong protein to start the morning?',
      options: ['Scrambled or boiled eggs', 'Frosted donut', 'Sweetened fruit punch'],
      answer: 0,
      note: 'Eggs pack complete protein, choline for your brain, and Vitamin D for your bones!',
      category: 'protein',
    },
    {
      id: 'q28',
      q: 'What color were the very first carrots grown by farmers hundreds of years ago?',
      options: ['Purple and yellow', 'Bright neon blue', 'Polka-dotted'],
      answer: 0,
      note: 'Ancient carrots were purple and yellow before orange carrots became popular—and purple carrots still exist!',
      category: 'vegetable',
    },
    {
      id: 'q29',
      q: 'Why do athletes eat carbohydrates like brown rice, pasta, or bananas before a big game?',
      options: [
        'Carbohydrates store quick-access fuel in your muscles',
        'To make their shoes heavier',
        "So they don't need to drink water",
      ],
      answer: 0,
      note: "Healthy carbs are your body's favorite fuel tank for running, jumping, and playing sports!",
      category: 'grain',
    },
    {
      id: 'q30',
      q: 'Which creamy green fruit is packed with healthy fats that help your body absorb vitamins?',
      options: ['Avocado', 'Green jellybean', 'Sour lime candy'],
      answer: 0,
      note: 'Avocados are a fruit rich in heart-healthy fats, fiber, and potassium!',
      category: 'fruit',
    },
  ],
  deletedQuestionIds: [],
  miniChallenge: {
    title: 'Rainbow Kitchen Quest',
    description: 'Find three different food colors in your kitchen or meal today and check them off!',
    cta: "I'll try it →",
  },
  didYouKnow: {
    title: 'Did you know?',
    fact: 'Bananas are berries, but strawberries are not botanically berries!',
  },
}

function mergeWithStarterBank(loaded: BrainBitesData): BrainBitesData {
  const deletedSet = new Set(loaded.deletedQuestionIds || [])
  const existingMap = new Map<string, BrainBitesQuestion>()
  for (const q of loaded.questions || []) {
    if (q && q.id && !deletedSet.has(q.id)) {
      existingMap.set(q.id, q)
    }
  }
  for (const starter of DEFAULT_BRAIN_BITES.questions) {
    if (!deletedSet.has(starter.id) && !existingMap.has(starter.id)) {
      existingMap.set(starter.id, starter)
    }
  }
  return {
    questions: Array.from(existingMap.values()),
    deletedQuestionIds: Array.from(deletedSet),
    miniChallenge: loaded.miniChallenge || DEFAULT_BRAIN_BITES.miniChallenge,
    didYouKnow: loaded.didYouKnow || DEFAULT_BRAIN_BITES.didYouKnow,
  }
}

async function readBrainBitesFile(): Promise<BrainBitesData> {
  // 1. First try reading live config from Supabase so Vercel deployments stay in sync
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('food_logs')
      .select('summary')
      .eq('id', BRAIN_BITES_ROW_ID)
      .maybeSingle()

    if (!error && data?.summary) {
      const parsed = JSON.parse(String(data.summary)) as BrainBitesData
      if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        return mergeWithStarterBank(parsed)
      }
    }
  } catch {
    // Fallback to local file or default
  }

  // 2. Fallback to local JSON file
  try {
    const filePath = path.join(process.cwd(), 'src', 'data', 'brainBites.json')
    const content = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content) as BrainBitesData
    if (Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      return mergeWithStarterBank(parsed)
    }
  } catch {
    // Ignore read error
  }

  return DEFAULT_BRAIN_BITES
}

async function writeBrainBitesFile(data: BrainBitesData): Promise<void> {
  // 1. Persist in Supabase using a valid food_group ('fruit') so Postgres check constraints never reject it
  try {
    const supabase = createAdminClient()
    const payload = {
      id: BRAIN_BITES_ROW_ID,
      user_id: null as string | null,
      food_name: BRAIN_BITES_CONFIG_NAME,
      food_group: 'fruit',
      score: 100,
      summary: JSON.stringify(data),
    }
    const { error } = await supabase.from('food_logs').upsert(payload)
    if (error) {
      // If user_id has a NOT NULL constraint in Supabase, attach to any existing profile ID
      const { data: anyProfile } = await supabase.from('profiles').select('id').limit(1).maybeSingle()
      if (anyProfile?.id) {
        await supabase.from('food_logs').upsert({
          ...payload,
          user_id: String(anyProfile.id),
        })
      }
    }
  } catch {
    // Ignore DB error if offline
  }

  // 2. Also update local JSON file when running in local dev
  try {
    const dirPath = path.join(process.cwd(), 'src', 'data')
    await fs.mkdir(dirPath, { recursive: true })
    const filePath = path.join(dirPath, 'brainBites.json')
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch {
    // Expected on read-only serverless environments like Vercel
  }
}

export async function generateAiQuizQuestionAction(
  topic?: string
): Promise<ActionResult<BrainBitesQuestion>> {
  const isAllowed = await verifyAdmin()
  if (!isAllowed) {
    return {
      ok: false,
      error: 'Unauthorized: Question generation and management is restricted to Administrators.',
    }
  }

  const cleanTopic = clean(topic, 60) || 'healthy foods, vitamins, and rainbow nutrition'
  const fallbackPool: Omit<BrainBitesQuestion, 'id'>[] = [
    {
      q: 'Which vitamin in oranges and strawberries helps protect your body from colds?',
      options: ['Vitamin C', 'Refined sugar', 'Cooking oil'],
      answer: 0,
      note: 'Vitamin C is an immune-system superhero found in citrus fruits, berries, and bell peppers!',
      category: 'fruit',
    },
    {
      q: 'What does dietary fiber in apples, beans, and broccoli help your body do?',
      options: ['Keep your tummy happy & full', 'Make your teeth turn green', 'Replace sleep'],
      answer: 0,
      note: 'Fiber feeds friendly gut bacteria and helps your digestion work smoothly!',
      category: 'vegetable',
    },
    {
      q: 'Which food group is the best builder for strong muscles after playing sports?',
      options: ['Mighty Proteins (eggs, fish, beans, chicken)', 'Sticky candies', 'Soda pop'],
      answer: 0,
      note: 'Protein provides amino acids, the building blocks your muscles need to grow and repair!',
      category: 'protein',
    },
    {
      q: 'Why do green leafy vegetables like spinach and broccoli make you feel energized?',
      options: [
        'They contain iron and folate for healthy blood',
        'They are full of caffeine',
        'They glow in the dark',
      ],
      answer: 0,
      note: 'Iron helps carry oxygen all through your body so you never feel tired!',
      category: 'vegetable',
    },
  ]

  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey })
      const prompt = `You are Bananini, the playful nutrition monkey for kids aged 5-12.
Create ONE fun multiple-choice nutrition quiz question about: "${cleanTopic}".
Return ONLY valid JSON with this exact shape (no markdown code fences):
{
  "q": "Question text here?",
  "options": ["Choice A", "Choice B", "Choice C"],
  "answer": 0,
  "note": "One cheerful sentence explaining why the answer is right!",
  "category": "fruit"
}`

      const modelsToTry = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash']
      for (const modelName of modelsToTry) {
        try {
          const res = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
          })
          const raw = (res.text || '').trim().replace(/^```json\s*/i, '').replace(/```$/i, '').trim()
          const parsed = JSON.parse(raw)
          if (
            parsed &&
            typeof parsed.q === 'string' &&
            Array.isArray(parsed.options) &&
            parsed.options.length >= 3
          ) {
            return {
              ok: true,
              data: {
                id: `ai_q_${Date.now()}`,
                q: clean(parsed.q, 180),
                options: [
                  clean(parsed.options[0], 80),
                  clean(parsed.options[1], 80),
                  clean(parsed.options[2], 80),
                ],
                answer: Math.max(0, Math.min(2, Number(parsed.answer) || 0)),
                note: clean(parsed.note, 200) || 'Healthy foods give your body awesome superpowers!',
                category: clean(parsed.category, 20) || 'habits',
              },
            }
          }
        } catch {
          // Try next model
        }
      }
    }
  } catch {
    // Fallback below
  }

  const pick = fallbackPool[Math.floor(Math.random() * fallbackPool.length)]
  return {
    ok: true,
    data: {
      id: `ai_q_${Date.now()}`,
      ...pick,
    },
  }
}

export async function getBrainBitesDataAction(): Promise<ActionResult<BrainBitesData>> {
  try {
    const data = await readBrainBitesFile()
    return { ok: true, data }
  } catch {
    return { ok: true, data: DEFAULT_BRAIN_BITES }
  }
}

export async function adminSaveBrainBitesQuestionAction(
  question: BrainBitesQuestion
): Promise<ActionResult<BrainBitesData>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const cleanQ = clean(question.q, 200)
    if (!cleanQ) return { ok: false, error: 'Question text cannot be empty.' }
    if (!Array.isArray(question.options) || question.options.length < 2) {
      return { ok: false, error: 'Please provide at least 2 answer choices.' }
    }

    const current = await readBrainBitesFile()
    const id = question.id?.trim() || `q_${Date.now()}`
    const cleanQuestion: BrainBitesQuestion = {
      id,
      q: cleanQ,
      options: question.options.map((o) => clean(o, 80)).filter(Boolean),
      answer: Math.max(0, Math.min(question.options.length - 1, Number(question.answer) || 0)),
      note: clean(question.note, 200),
      category: clean(question.category, 20) || 'habits',
    }

    const existingIndex = current.questions.findIndex((q) => q.id === id)
    if (existingIndex >= 0) {
      current.questions[existingIndex] = cleanQuestion
    } else {
      // Put newly added admin questions at the front so they are prioritized in the daily 15!
      current.questions.unshift(cleanQuestion)
    }

    if (current.deletedQuestionIds) {
      current.deletedQuestionIds = current.deletedQuestionIds.filter((delId) => delId !== id)
    }

    await writeBrainBitesFile(current)
    return { ok: true, data: current }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to save question.'
    return { ok: false, error: msg }
  }
}

export async function adminDeleteBrainBitesQuestionAction(
  questionId: string
): Promise<ActionResult<BrainBitesData>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const current = await readBrainBitesFile()
    current.questions = current.questions.filter((q) => q.id !== questionId)
    const deletedSet = new Set(current.deletedQuestionIds || [])
    deletedSet.add(questionId)
    current.deletedQuestionIds = Array.from(deletedSet)

    await writeBrainBitesFile(current)
    return { ok: true, data: current }
  } catch {
    return { ok: false, error: 'Failed to delete question.' }
  }
}

export async function adminUpdateBrainBitesExtrasAction(input: {
  miniChallenge: { title: string; description: string; cta: string }
  didYouKnow: { title: string; fact: string }
}): Promise<ActionResult<BrainBitesData>> {
  try {
    const isAllowed = await verifyAdmin()
    if (!isAllowed) return { ok: false, error: 'Unauthorized.' }

    const current = await readBrainBitesFile()
    current.miniChallenge = {
      title: clean(input.miniChallenge?.title, 60) || 'Mini challenge',
      description: clean(input.miniChallenge?.description, 200) || '',
      cta: clean(input.miniChallenge?.cta, 40) || "I'll try it →",
    }
    current.didYouKnow = {
      title: clean(input.didYouKnow?.title, 60) || 'Did you know?',
      fact: clean(input.didYouKnow?.fact, 250) || '',
    }

    await writeBrainBitesFile(current)
    return { ok: true, data: current }
  } catch {
    return { ok: false, error: 'Failed to update extras.' }
  }
}



