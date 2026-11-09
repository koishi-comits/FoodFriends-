import { cookies } from 'next/headers'
import FoodFriendsApp, { type View } from './FoodFriendsApp'
import { sessionAction } from './actions'

const VALID_VIEWS: View[] = [
  'home',
  'scan',
  'log',
  'learn',
  'chat',
  'profile',
  'analytics',
  'admin',
]

export default async function HomePage() {
  const [sessionRes, cookieStore] = await Promise.all([sessionAction(), cookies()])
  const initialUser = sessionRes.ok ? sessionRes.data : null
  const savedView = cookieStore.get('foodfriends_active_view')?.value as View | undefined

  let initialView: View =
    savedView && VALID_VIEWS.includes(savedView) ? savedView : 'home'

  if (initialView === 'admin' && !initialUser?.isAdmin) {
    initialView = 'home'
  }

  return <FoodFriendsApp initialUser={initialUser} initialView={initialView} />
}
