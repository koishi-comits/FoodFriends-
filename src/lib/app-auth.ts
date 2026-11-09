import 'server-only'

import config from '@payload-config'
import { cookies } from 'next/headers'
import { getPayload } from 'payload'
import type { User } from '@/payload-types'

const SESSION_COOKIE = 'app-session'

export type AppUser = User

export function createAppAuth() {
  return {
    async currentUser(): Promise<AppUser | null> {
      const token = (await cookies()).get(SESSION_COOKIE)?.value
      if (!token) return null

      const payload = await getPayload({ config })
      const authHeaders = new Headers({ Authorization: `JWT ${token}` })
      const { user } = await payload.auth({ headers: authHeaders })
      if (!user || user.collection !== 'users') return null
      return user as AppUser
    },

    async login(email: string, password: string): Promise<AppUser> {
      const payload = await getPayload({ config })
      const result = await payload.login({
        collection: 'users',
        data: { email, password },
      })
      if (!result.token || !result.user || result.user.collection !== 'users') {
        throw new Error('Unable to start your session.')
      }

      ;(await cookies()).set(SESSION_COOKIE, result.token, {
        httpOnly: true,
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      })
      return result.user as AppUser
    },

    async logout() {
      ;(await cookies()).delete(SESSION_COOKIE)
    },
  }
}

export const appAuth = createAppAuth()
