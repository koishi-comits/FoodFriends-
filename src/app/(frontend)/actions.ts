'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { GoogleGenAI } from '@google/genai'
import fs from 'fs/promises'
import path from 'path'

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

Examine this food photo very carefully.
1. Identify the food accurately based ONLY on what you see in the photo (e.g. if you see pancakes, it is Pancakes/Grain; if you see an apple, it is Apple/Fruit; if you see chicken nuggets, it is Protein/Treat).
2. ESTIMATE THE QUANTITY / PORTION SHOWN IN THE PHOTO (e.g. "Stack of 5 pancakes (~220g)", "1 medium apple (~150g)", "Bowl of cereal with milk (~250ml)").
3. CALCULATE THE NUTRITION FACTS SCALED SPECIFICALLY TO THAT VISIBLE QUANTITY (e.g. if there are 5 pancakes, calculate calories and protein for all 5 pancakes, not just 1 small bite!).

Return ONLY a valid raw JSON object (no markdown, no backticks, no fences, no comments) with this exact structure:
{
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
- "group" MUST be exactly one of: "fruit", "vegetable", "protein", "grain", "dairy", "treat"
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
        return { ok: false, error: 'Bananini got confused! Try taking a clearer photo.' }
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
    const { data, error } = await supabase
      .from(tableName)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)

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
}

export type BrainBitesData = {
  questions: BrainBitesQuestion[]
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

const DEFAULT_BRAIN_BITES: BrainBitesData = {
  questions: [
    {
      id: 'q1',
      q: 'Which snack gives you long-lasting energy?',
      options: ['Apple & peanut butter', 'Gummy candy', 'Fizzy drink'],
      answer: 0,
      note: 'Fruit plus protein is a power-team for steady energy.',
    },
    {
      id: 'q2',
      q: 'Which color should join your plate next?',
      options: ['A new veggie color', 'Only beige foods', 'No colors'],
      answer: 0,
      note: 'Different colors often bring different helpful nutrients.',
    },
    {
      id: 'q3',
      q: 'What is the best everyday drink?',
      options: ['Water', 'Soda', 'Energy drink'],
      answer: 0,
      note: 'Water hydrates your body and brain so you can run and think fast.',
    },
  ],
  miniChallenge: {
    title: 'Mini challenge',
    description: 'Find three different food colors in your kitchen with a grown-up.',
    cta: "I'll try it →",
  },
  didYouKnow: {
    title: 'Did you know?',
    fact: 'Bananas are berries, but strawberries are not botanically berries.',
  },
}

async function readBrainBitesFile(): Promise<BrainBitesData> {
  try {
    const filePath = path.join(process.cwd(), 'src', 'data', 'brainBites.json')
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as BrainBitesData
  } catch {
    return DEFAULT_BRAIN_BITES
  }
}

async function writeBrainBitesFile(data: BrainBitesData): Promise<void> {
  const dirPath = path.join(process.cwd(), 'src', 'data')
  await fs.mkdir(dirPath, { recursive: true })
  const filePath = path.join(dirPath, 'brainBites.json')
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8')
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
    }

    const existingIndex = current.questions.findIndex((q) => q.id === id)
    if (existingIndex >= 0) {
      current.questions[existingIndex] = cleanQuestion
    } else {
      current.questions.push(cleanQuestion)
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



