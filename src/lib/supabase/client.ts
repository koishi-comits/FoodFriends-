import { createBrowserClient } from '@supabase/ssr'

const DEFAULT_PUBLIC_SUPABASE_URL = 'https://xmmmkqnrzlpomapeyzds.supabase.co'
const DEFAULT_PUBLIC_SUPABASE_KEY = 'sb_publishable_324duK941tiQ-QrSZ4ZaOQ_mGX3mqTZ'

export function createClient() {
  const rawUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/^['"]|['"]$/g, '')
  const url =
    rawUrl.startsWith('https://') && rawUrl.includes('.supabase.co')
      ? rawUrl
      : DEFAULT_PUBLIC_SUPABASE_URL

  const rawKey = (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    ''
  )
    .trim()
    .replace(/^['"]|['"]$/g, '')

  const key =
    rawKey.startsWith('sb_publishable_') || rawKey.startsWith('eyJ')
      ? rawKey
      : DEFAULT_PUBLIC_SUPABASE_KEY

  return createBrowserClient(url, key)
}

