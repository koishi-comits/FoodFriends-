import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const DEFAULT_PUBLIC_SUPABASE_URL = 'https://xmmmkqnrzlpomapeyzds.supabase.co'
const DEFAULT_PUBLIC_SUPABASE_KEY = 'sb_publishable_324duK941tiQ-QrSZ4ZaOQ_mGX3mqTZ'

function resolveSupabaseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/^['"]|['"]$/g, '')
  if (raw.startsWith('https://') && raw.includes('.supabase.co')) {
    return raw
  }
  return DEFAULT_PUBLIC_SUPABASE_URL
}

function resolveSupabasePublicKey(): string {
  const raw = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  )
    .trim()
    .replace(/^['"]|['"]$/g, '')

  if (raw.startsWith('sb_publishable_') || raw.startsWith('eyJ')) {
    return raw
  }
  return DEFAULT_PUBLIC_SUPABASE_KEY
}

export async function createClient() {
  const cookieStore = await cookies()
  const url = resolveSupabaseUrl()
  const key = resolveSupabasePublicKey()

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Can be ignored if called from Server Component
        }
      },
    },
  })
}

export function createAdminClient() {
  const url = resolveSupabaseUrl()
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')

  const key =
    serviceKey.startsWith('sb_secret_') || serviceKey.startsWith('eyJ')
      ? serviceKey
      : resolveSupabasePublicKey()

  return createSupabaseClient(url, key, {
    auth: { persistSession: false },
  })
}


