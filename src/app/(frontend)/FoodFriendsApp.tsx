'use client'

import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react'
import {
  adminDeleteBrainBitesQuestionAction,
  adminSaveBrainBitesQuestionAction,
  adminUpdateBrainBitesExtrasAction,
  analyzeFoodAction,
  askBananiniAction,
  deleteUserFoodLogAction,
  getBrainBitesDataAction,
  getFoodLogsAction,
  loginAction,
  logoutAction,
  saveScanAction,
  sessionAction,
  signupAction,
  updateOwnProfileAction,
  type BrainBitesData,
  type BrainBitesQuestion,
  type FoodAnalysis,
  type FoodLogItem,
  type FoodNutrients,
  type UserSession as PublicUser,
} from './actions'
import AdminDashboard from './AdminDashboard'
import FoodAnalyticsView from './FoodAnalyticsView'

export type View = 'home' | 'scan' | 'log' | 'learn' | 'chat' | 'profile' | 'analytics' | 'admin'
type FoodGroup = FoodAnalysis['group']

function computeAccurateStatsFromLogs(logs: { created_at: string }[]): {
  points: number
  streak: number
} {
  const points = logs.length * 15
  if (logs.length === 0) return { points: 0, streak: 0 }

  const toKey = (d: Date) => {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }

  const uniqueDays = new Set<string>()
  logs.forEach((item) => {
    if (!item.created_at) return
    const d = new Date(item.created_at)
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
type IconName =
  | 'home'
  | 'scan'
  | 'book'
  | 'learn'
  | 'chat'
  | 'user'
  | 'fire'
  | 'star'
  | 'camera'
  | 'arrow'
  | 'check'
  | 'lock'
  | 'send'
  | 'close'
  | 'leaf'
  | 'shield'
  | 'chart'

type ScanResult = FoodAnalysis

const navItems: { id: View; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'scan', label: 'Scan', icon: 'scan' },
  { id: 'log', label: 'Explorer Log', icon: 'book' },
  { id: 'learn', label: 'Learn', icon: 'learn' },
  { id: 'chat', label: 'Ask Bananini', icon: 'chat' },
  { id: 'analytics', label: 'Food Analytics', icon: 'chart' },
]

const questions = [
  {
    q: 'Which snack gives you long-lasting energy?',
    options: ['Apple & peanut butter', 'Gummy candy', 'Fizzy drink'],
    answer: 0,
    note: 'Fruit plus protein is a power-team for steady energy.',
  },
  {
    q: 'Which color should join your plate next?',
    options: ['A new veggie color', 'Only beige foods', 'No colors'],
    answer: 0,
    note: 'Different colors often bring different helpful nutrients.',
  },
  {
    q: 'What is the best everyday drink?',
    options: ['Water', 'Soda', 'Energy drink'],
    answer: 0,
    note: 'Water helps your brain and body do their best work.',
  },
]

function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    home: (
      <>
        <path d="m3 10 9-7 9 7" />
        <path d="M5 9v11h14V9M9 20v-7h6v7" />
      </>
    ),
    scan: (
      <>
        <path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        <circle cx="12" cy="12" r="4" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
        <path d="M6 6h10M6 10h10M6 14h6" />
      </>
    ),
    learn: (
      <>
        <path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23.5z" />
        <path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5a3.5 3.5 0 0 1 3.5 3.5z" />
      </>
    ),
    chat: (
      <>
        <path d="M20 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-1-2.6V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4z" />
        <path d="M8 10h.01M12 10h.01M16 10h.01" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    fire: (
      <path d="M12 22c4 0 7-3 7-7 0-3-1.5-5.5-4.5-8.5 0 3-1 4.5-2.5 5.5.2-4-2-7-5-9 1 5-2 7-2 12 0 4 3 7 7 7Z" />
    ),
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
    camera: (
      <>
        <path d="M4 7h4l1.5-2h5L16 7h4v12H4z" />
        <circle cx="12" cy="13" r="4" />
      </>
    ),
    arrow: (
      <>
        <path d="M5 12h14M14 7l5 5-5 5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    leaf: (
      <>
        <path d="M20 4C10 4 5 9 5 15c0 3 2 5 5 5 6 0 10-6 10-16Z" />
        <path d="M5 21c2-6 6-9 12-13" />
      </>
    ),
    shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
    chart: <path d="M18 20V10M12 20V4M6 20v-6" />,
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function Bananini({ small = false }: { small?: boolean }) {
  return (
    <img
      src="/bananini.png"
      alt="Bananini the monkey"
      className={small ? 'h-[72px] w-[72px] object-contain' : 'h-56 w-56 sm:h-64 sm:w-64 object-contain'}
    />
  )
}

function Button({
  children,
  onClick,
  tone = 'green',
  className = '',
  type = 'button',
  disabled = false,
}: {
  children: ReactNode
  onClick?: () => void
  tone?: 'green' | 'yellow' | 'white'
  className?: string
  type?: 'button' | 'submit'
  disabled?: boolean
}) {
  const tones = {
    green: 'bg-[#287A52] text-white shadow-[0_5px_0_#195F3D] hover:bg-[#216c47]',
    yellow: 'bg-[#FFD84D] text-[#3D2A1E] shadow-[0_5px_0_#DBAD23] hover:bg-[#ffdf67]',
    white: 'bg-white text-[#254336] shadow-[0_5px_0_#DDE8DE] hover:bg-[#f8fbf7]',
  }
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-extrabold transition active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 ${tones[tone]} ${className}`}
    >
      {children}
    </button>
  )
}

function resultFor(name: string): ScanResult {
  const n = name.toLowerCase()
  if (n.includes('pancake') || n.includes('waffle')) {
    return {
      name: name || 'Fluffy Golden Pancakes',
      group: 'grain',
      estimatedPortion: 'Stack of 5 golden pancakes (~220g)',
      score: 74,
      summary: 'Fluffy golden pancakes to fuel your active morning!',
      color: '#C89A5D',
      explanation:
        'Pancakes are made from grains that provide steady carbohydrates for active energy. Pair them with fresh fruit or eggs for an even more balanced breakfast!',
      nutrients: {
        calories: '450 kcal',
        protein: '9g',
        carbs: '75g',
        fat: '12g',
        fiber: '2.5g',
        sugar: '14g',
        vitamins: ['Vitamin B1 (Thiamine)', 'Vitamin B2 (Riboflavin)', 'Folate'],
        minerals: ['Calcium', 'Iron', 'Phosphorus'],
      },
      funFact: 'Pancakes have been enjoyed around the world since ancient Greek and Roman times!',
      tip: 'Top with sliced bananas or fresh strawberries instead of heavy syrup for natural fruit sweetness!',
    }
  }
  if (
    n.includes('broccoli') ||
    n.includes('carrot') ||
    n.includes('vegetable') ||
    n.includes('salad') ||
    n.includes('tomato')
  ) {
    return {
      name: name || 'Crunchy vegetables',
      group: 'vegetable',
      estimatedPortion: '1 cup fresh chopped veggies (~120g)',
      score: 96,
      summary: 'A colorful everyday choice packed with fiber and vitamins.',
      color: '#65A968',
      explanation:
        'Vegetables are nature’s powerhouses! Packed with dietary fiber, vitamin A, and antioxidants, they support digestion, glowing skin, and strong eyesight.',
      nutrients: {
        calories: '45 kcal',
        protein: '2.5g',
        carbs: '8g',
        fat: '0.4g',
        fiber: '3.8g',
        sugar: '2.2g',
        vitamins: ['Vitamin A', 'Vitamin C', 'Vitamin K'],
        minerals: ['Potassium', 'Calcium', 'Folate'],
      },
      funFact: 'Broccoli contains as much Vitamin C as an orange!',
      tip: 'Eat a rainbow of different colored veggies every week.',
    }
  }
  if (
    n.includes('egg') ||
    n.includes('chicken') ||
    n.includes('bean') ||
    n.includes('fish') ||
    n.includes('meat') ||
    n.includes('beef') ||
    n.includes('pork') ||
    n.includes('tofu')
  ) {
    return {
      name: name || 'Protein food',
      group: 'protein',
      estimatedPortion: '1 portion (~150g)',
      score: 90,
      summary: 'Protein helps growing muscles. Pair it with a colorful plant food.',
      color: '#E99D55',
      explanation:
        'Protein provides the essential amino acids your body needs to rebuild muscles, support strong hair and nails, and keep you satisfied between meals.',
      nutrients: {
        calories: '165 kcal',
        protein: '26g',
        carbs: '0g',
        fat: '4.5g',
        fiber: '0g',
        sugar: '0g',
        vitamins: ['Vitamin B6', 'Vitamin B12', 'Niacin'],
        minerals: ['Iron', 'Zinc', 'Phosphorus'],
      },
      funFact: 'Eggs contain almost every single vitamin your body needs except Vitamin C!',
      tip: 'Balance protein with fresh veggies or whole grains on your plate.',
    }
  }
  if (n.includes('yogurt') || n.includes('milk') || n.includes('cheese')) {
    return {
      name: name || 'Dairy food',
      group: 'dairy',
      estimatedPortion: '1 cup serving (~200g)',
      score: 84,
      summary: 'A calcium helper for strong bones. Look for less added sugar.',
      color: '#81A8D9',
      explanation:
        'Dairy supplies bioavailable calcium and vitamin D to fortify bones and teeth, along with probiotics in yogurt for healthy gut bacteria.',
      nutrients: {
        calories: '120 kcal',
        protein: '9g',
        carbs: '12g',
        fat: '3.5g',
        fiber: '0g',
        sugar: '9g',
        vitamins: ['Vitamin D', 'Vitamin B2', 'Vitamin A'],
        minerals: ['Calcium', 'Phosphorus', 'Potassium'],
      },
      funFact: 'A single cup of yogurt can provide 30% of your daily calcium needs!',
      tip: 'Choose plain or Greek yogurt with fresh berries instead of flavored sugary cups.',
    }
  }
  if (
    n.includes('candy') ||
    n.includes('cookie') ||
    n.includes('soda') ||
    n.includes('cake') ||
    n.includes('chocolate') ||
    n.includes('chips') ||
    n.includes('donut') ||
    n.includes('ice cream')
  ) {
    return {
      name: name || 'Sweet treat',
      group: 'treat',
      estimatedPortion: '1 small treat portion (~50g)',
      score: 48,
      summary: 'A sometimes food. Enjoy a small amount and add water or fruit.',
      color: '#D97984',
      explanation:
        'Treats give a quick burst of fast-burning sugar energy, but little long-term fuel. Perfect for celebrating occasionally in mindful portions!',
      nutrients: {
        calories: '220 kcal',
        protein: '2g',
        carbs: '34g',
        fat: '9g',
        fiber: '0.8g',
        sugar: '24g',
        vitamins: ['Vitamin B1'],
        minerals: ['Sodium'],
      },
      funFact: 'Dark chocolate with high cocoa contains healthy plant flavanols!',
      tip: 'Enjoy your treat after a nourishing meal rather than on an empty stomach.',
    }
  }
  if (
    n.includes('bread') ||
    n.includes('rice') ||
    n.includes('oat') ||
    n.includes('pasta') ||
    n.includes('cereal') ||
    n.includes('corn')
  ) {
    return {
      name: name || 'Whole grain',
      group: 'grain',
      estimatedPortion: '1 medium bowl (~160g)',
      score: 82,
      summary: 'Grains give energy. Whole-grain choices keep your engine going longer.',
      color: '#C89A5D',
      explanation:
        'Whole grains are full of complex carbohydrates and soluble fiber that break down steadily, fueling your brain and keeping stamina steady for hours.',
      nutrients: {
        calories: '150 kcal',
        protein: '5g',
        carbs: '32g',
        fat: '1.2g',
        fiber: '4g',
        sugar: '1g',
        vitamins: ['Thiamine (B1)', 'Riboflavin (B2)', 'Folate'],
        minerals: ['Magnesium', 'Iron', 'Selenium'],
      },
      funFact: 'Oats have a unique fiber called beta-glucan that supports a healthy heart!',
      tip: 'Look for brown rice or whole wheat labels to get 3x more natural fiber.',
    }
  }
  return {
    name: name || 'Fresh fruit',
    group: 'fruit',
    estimatedPortion: '1 medium piece (~140g)',
    score: 94,
    summary: 'A naturally sweet everyday choice with fiber for a happy tummy.',
    color: '#E45B4E',
    explanation:
      'Fruits deliver natural fructose, hydration, and pectin fiber. They satisfy sweet cravings while providing cellular defense through vitamin C and polyphenols.',
    nutrients: {
      calories: '95 kcal',
      protein: '0.5g',
      carbs: '25g',
      fat: '0.3g',
      fiber: '4.4g',
      sugar: '19g',
      vitamins: ['Vitamin C', 'Vitamin K', 'Beta-Carotene'],
      minerals: ['Potassium', 'Manganese'],
    },
    funFact: 'Apples float in water because 25% of their volume is actually air!',
    tip: 'Keep the peel on when eating apples — that is where half the fiber lives!',
  }
}

function foodPowers(group: ScanResult['group']) {
  const powers: Record<ScanResult['group'], { label: string; value: string; color: string }[]> = {
    fruit: [
      { label: 'Fiber', value: 'Tummy helper', color: '#78C850' },
      { label: 'Vitamin C', value: 'Body defender', color: '#FFB52E' },
      { label: 'Natural energy', value: 'Ready to play', color: '#F05D7B' },
    ],
    vegetable: [
      { label: 'Fiber', value: 'Tummy helper', color: '#78C850' },
      { label: 'Vitamins', value: 'Color power', color: '#FFB52E' },
      { label: 'Water', value: 'Hydration helper', color: '#45AFE8' },
    ],
    protein: [
      { label: 'Protein', value: 'Muscle builder', color: '#F28A32' },
      { label: 'Iron', value: 'Energy helper', color: '#E75A73' },
      { label: 'B vitamins', value: 'Brain fuel', color: '#8958D8' },
    ],
    grain: [
      { label: 'Carbohydrates', value: 'Energy fuel', color: '#E4A93B' },
      { label: 'Fiber', value: 'Tummy helper', color: '#78C850' },
      { label: 'B vitamins', value: 'Brain fuel', color: '#8958D8' },
    ],
    dairy: [
      { label: 'Calcium', value: 'Bone builder', color: '#45AFE8' },
      { label: 'Protein', value: 'Muscle helper', color: '#F28A32' },
      { label: 'Vitamin D', value: 'Sunshine helper', color: '#FFCC35' },
    ],
    treat: [
      { label: 'Quick energy', value: 'Sometimes food', color: '#F05D7B' },
      { label: 'Portion', value: 'A little is plenty', color: '#8958D8' },
      { label: 'Power pair', value: 'Add fruit or water', color: '#45AFE8' },
    ],
  }
  return powers[group]
}

export default function FoodFriendsApp({
  initialUser = null,
  initialView = 'home',
}: {
  initialUser?: PublicUser | null
  initialView?: View
}) {
  const [view, setView] = useState<View>(initialView)
  const [user, setUser] = useState<PublicUser | null>(initialUser)
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [authError, setAuthError] = useState('')
  const [isPending, startTransition] = useTransition()

  // Lifted state so scans are preserved when switching tabs & across refreshes!
  const [persistedScan, setPersistedScan] = useState<{
    photo: string | null
    photoBase64: string | null
    photoMime: string
    result: FoodAnalysis | null
    saved?: boolean
  }>({
    photo: null,
    photoBase64: null,
    photoMime: 'image/jpeg',
    result: null,
    saved: false,
  })

  // Prefill prompt & persisted messages for Ask Bananini
  const [chatPrefill, setChatPrefill] = useState<string>('')
  const [chatMessages, setChatMessages] = useState<{ from: 'bot' | 'user'; text: string }[]>([
    {
      from: 'bot',
      text: '🍌 Hi! I’m Bananini. Ask me anything about foods, snacks, superpowers, or building a colorful plate!',
    },
  ])

  // Restore scan & chat state from sessionStorage on client mount
  useEffect(() => {
    try {
      const savedScanRaw = sessionStorage.getItem('foodfriends_persisted_scan')
      if (savedScanRaw) {
        const parsed = JSON.parse(savedScanRaw)
        if (parsed && (parsed.photo || parsed.result)) {
          setPersistedScan(parsed)
        }
      }
      const savedChatRaw = sessionStorage.getItem('foodfriends_chat_messages')
      if (savedChatRaw) {
        const parsedChat = JSON.parse(savedChatRaw)
        if (Array.isArray(parsedChat) && parsedChat.length > 0) {
          setChatMessages(parsedChat)
        }
      }
    } catch {
      // ignore storage errors
    }
  }, [])

  // Persist scan state to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('foodfriends_persisted_scan', JSON.stringify(persistedScan))
    } catch {
      // ignore quota errors
    }
  }, [persistedScan])

  // Persist chat messages to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem('foodfriends_chat_messages', JSON.stringify(chatMessages))
    } catch {
      // ignore quota errors
    }
  }, [chatMessages])

  const persistActiveView = (next: View) => {
    setView(next)
    try {
      document.cookie = `foodfriends_active_view=${next}; path=/; max-age=31536000; SameSite=Lax`
      localStorage.setItem('foodfriends_active_view', next)
    } catch {
      // ignore cookie/storage errors
    }
  }

  const navigate = (next: View) => {
    persistActiveView(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submitAuth = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setAuthError('')
    const data = new FormData(event.currentTarget)
    startTransition(async () => {
      const result =
        authMode === 'login'
          ? await loginAction({
              email: String(data.get('email') ?? ''),
              password: String(data.get('password') ?? ''),
            })
          : await signupAction({
              ageGroup: String(data.get('ageGroup') ?? '7-9'),
              displayName: String(data.get('displayName') ?? ''),
              email: String(data.get('email') ?? ''),
              password: String(data.get('password') ?? ''),
            })
      if (result.ok) {
        setUser(result.data)
        setAuthOpen(false)
        if (result.data.isAdmin) {
          persistActiveView('admin')
        } else {
          persistActiveView('profile')
        }
      } else setAuthError(result.error)
    })
  }

  const currentNavItems = user?.isAdmin
    ? [
        ...navItems,
        { id: 'admin' as View, label: 'Manage System', icon: 'shield' as IconName },
      ]
    : navItems

  return (
    <div className="min-h-screen bg-[#EAF9FF] text-[#173C4A]">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col border-r border-[#CDEBF2] bg-[#FFFDF5] px-5 py-7 lg:flex">
        <Brand />
        <nav className="mt-12 space-y-2" aria-label="Main navigation">
          {currentNavItems.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={view === item.id}
              onClick={() => navigate(item.id)}
            />
          ))}
        </nav>
        <div className="mt-auto rounded-[26px] bg-[#CFF2A9] p-4">
          <div className="flex items-center gap-3">
            <Bananini small />
            <div>
              <p className="text-xs font-bold text-[#57745D]">BANANINI SAYS</p>
              <p className="mt-1 text-sm font-extrabold leading-snug">
                “Every color is a new power!”
              </p>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-[#CDEBF2] bg-[#EAF9FF]/95 px-5 backdrop-blur sm:px-8 lg:px-10">
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="hidden lg:block">
            <p className="text-sm font-bold text-[#6D7C72]">Food explorer dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <button
                onClick={() => navigate('analytics')}
                className={`hidden sm:flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-black transition ${
                  view === 'analytics'
                    ? 'bg-[#173C4A] text-white shadow-xs'
                    : 'border border-[#D7DFD3] bg-white text-[#173C4A] hover:bg-[#EAF5FA]'
                }`}
              >
                <Icon name="chart" size={14} />
                <span>Food Analytics</span>
              </button>
            )}
            {user?.isAdmin && (
              <button
                onClick={() => navigate('admin')}
                className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-black transition ${
                  view === 'admin'
                    ? 'bg-[#173C4A] text-white shadow-xs'
                    : 'bg-[#FFD84D] text-[#3D2A1E] hover:bg-[#FFE27B]'
                }`}
              >
                <Icon name="shield" size={14} />
                <span>Manage System</span>
              </button>
            )}
            {user && (
              <div className="hidden items-center gap-2 rounded-full bg-white px-3 py-2 text-sm font-extrabold shadow-xs sm:flex">
                <Icon name="fire" size={18} />
                <span>
                  {user.streak} {user.streak === 1 ? 'day' : 'days'} streak
                </span>
              </div>
            )}
            <button
              onClick={() => (user ? navigate('profile') : setAuthOpen(true))}
              className="flex h-11 items-center gap-2 rounded-full border border-[#D7DFD3] bg-white px-2.5 sm:pr-4"
              aria-label={user ? 'Open profile' : 'Sign in'}
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FFD84D]">
                <Icon name="user" size={16} />
              </span>
              <span className="hidden text-sm font-extrabold sm:inline">
                {user?.displayName ?? 'Sign in'}
              </span>
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-[1320px] px-5 pb-28 pt-7 sm:px-8 lg:px-10 lg:pb-12">
          {view === 'home' && (
            <Home
              user={user}
              navigate={navigate}
              lastScan={persistedScan.result}
              onAskBananini={(promptText) => {
                setChatPrefill(promptText)
                navigate('chat')
              }}
            />
          )}
          {view === 'scan' && (
            <Scanner
              user={user}
              onSignIn={() => setAuthOpen(true)}
              scanState={persistedScan}
              onUpdateScanState={setPersistedScan}
              onStatsChange={(points, streak) =>
                setUser((prev) => (prev ? { ...prev, points, streak } : prev))
              }
              onAskBananini={(foodName) => {
                setChatPrefill(
                  `Hi Bananini! Can you tell me more about ${foodName}? What superpowers does it give me and what are some fun healthy ways to eat it?`
                )
                navigate('chat')
              }}
            />
          )}
          {view === 'log' && (
            <ExplorerLogView
              user={user}
              onSignIn={() => setAuthOpen(true)}
              onScanMore={() => navigate('scan')}
              onStatsChange={(points, streak) =>
                setUser((prev) => (prev ? { ...prev, points, streak } : prev))
              }
              onAskBananini={(foodName) => {
                setChatPrefill(`Hi Bananini! Tell me about ${foodName}!`)
                navigate('chat')
              }}
            />
          )}
          {view === 'learn' && <Learn isAdmin={Boolean(user?.isAdmin)} />}
          {view === 'chat' && (
            <Chat
              user={user}
              onSignIn={() => setAuthOpen(true)}
              messages={chatMessages}
              setMessages={setChatMessages}
              initialPrompt={chatPrefill}
              onClearPrefill={() => setChatPrefill('')}
              scannedFood={persistedScan.result}
              onGoToScan={() => navigate('scan')}
            />
          )}
          {view === 'analytics' && (
            <FoodAnalyticsView
              user={user}
              onSignIn={() => setAuthOpen(true)}
              onBack={() => navigate('home')}
            />
          )}
          {view === 'admin' && user?.isAdmin && (
            <AdminDashboard onBack={() => navigate('home')} />
          )}
          {view === 'profile' && (
            <Profile
              user={user}
              onUpdateUser={setUser}
              openAuth={() => setAuthOpen(true)}
              onOpenAdmin={() => navigate('admin')}
              onOpenAnalytics={() => navigate('analytics')}
              onOpenLog={() => navigate('log')}
              onOpenScan={() => navigate('scan')}
              onAskBananini={(foodName) => {
                setChatPrefill(`Hi Bananini! Tell me more about ${foodName}!`)
                navigate('chat')
              }}
              onLogout={() =>
                startTransition(async () => {
                  await logoutAction()
                  setUser(null)
                  persistActiveView('home')
                })
              }
            />
          )}
        </main>
      </div>

      <nav
        className={`fixed inset-x-3 bottom-3 z-30 grid ${
          user?.isAdmin ? 'grid-cols-7' : 'grid-cols-6'
        } rounded-[24px] border border-[#DDE3D8] bg-white/95 p-2 shadow-[0_12px_40px_rgba(39,68,51,.18)] backdrop-blur lg:hidden`}
        aria-label="Mobile navigation"
      >
        {currentNavItems.map((item) => (
          <NavButton
            key={item.id}
            item={item}
            active={view === item.id}
            onClick={() => navigate(item.id)}
            mobile
          />
        ))}
      </nav>

      {authOpen && (
        <AuthModal
          mode={authMode}
          setMode={setAuthMode}
          onClose={() => setAuthOpen(false)}
          onSubmit={submitAuth}
          error={authError}
          pending={isPending}
        />
      )}
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-10 w-10 place-items-center rounded-[14px] bg-[#FFD84D] text-[#3D2A1E]">
        <Icon name="leaf" />
      </span>
      <span className="text-xl font-black tracking-[-.04em] text-[#224735]">
        Food<span className="text-[#E89542]">Freinds</span>
      </span>
    </div>
  )
}

function NavButton({
  item,
  active,
  onClick,
  mobile = false,
}: {
  item: (typeof navItems)[number]
  active: boolean
  onClick: () => void
  mobile?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`${mobile ? 'flex-col gap-1 py-1 text-[10px]' : 'w-full gap-3 px-4 py-3 text-sm'} flex items-center rounded-2xl font-extrabold transition ${active ? 'bg-[#287A52] text-white shadow-[0_4px_0_#195F3D]' : 'text-[#607166] hover:bg-white'}`}
    >
      <Icon name={item.icon} size={mobile ? 20 : 21} />
      <span>
        {mobile && item.id === 'chat'
          ? 'Ask'
          : mobile && item.id === 'log'
            ? 'Log'
            : mobile && item.id === 'analytics'
              ? 'Stats'
              : item.label}
      </span>
    </button>
  )
}

function Home({
  user,
  navigate,
  lastScan,
  onAskBananini,
}: {
  user: PublicUser | null
  navigate: (view: View) => void
  lastScan: FoodAnalysis | null
  onAskBananini: (promptText: string) => void
}) {
  const [logs, setLogs] = useState<FoodLogItem[]>([])
  const [loadingLogs, setLoadingLogs] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<FoodGroup | null>(null)

  useEffect(() => {
    setLoadingLogs(true)
    getFoodLogsAction()
      .then((res) => {
        if (res.ok) setLogs(res.data)
      })
      .finally(() => setLoadingLogs(false))
  }, [user])

  // Compute real weekly activity (Monday = 0 ... Sunday = 6)
  const now = new Date()
  const currentDayIndex = (now.getDay() + 6) % 7 // Mon=0, Sun=6
  const startOfWeek = new Date(now)
  startOfWeek.setDate(now.getDate() - currentDayIndex)
  startOfWeek.setHours(0, 0, 0, 0)

  const activeWeekDays = new Set<number>()
  logs.forEach((item) => {
    const d = new Date(item.created_at)
    if (d >= startOfWeek) {
      const idx = (d.getDay() + 6) % 7
      activeWeekDays.add(idx)
    }
  })

  // Compute Rainbow Plate progress across the 6 food groups (ONLY saved logs count!)
  const groupCounts = logs.reduce(
    (acc, item) => {
      acc[item.food_group] = (acc[item.food_group] || 0) + 1
      return acc
    },
    {} as Record<string, number>
  )

  const rainbowCards: {
    group: FoodGroup
    title: string
    emoji: string
    foods: string
    help: string
    color: string
    superpower: string
  }[] = [
    {
      group: 'fruit',
      title: 'Red & Berry Fruits',
      emoji: '🍎',
      foods: 'Apples, berries, bananas & mangoes',
      help: 'Heart & Immunity Helper',
      color: '#F7D5D1',
      superpower:
        'Packed with Vitamin C, natural fiber, and antioxidants that protect your cells and give quick playful energy!',
    },
    {
      group: 'vegetable',
      title: 'Green & Crunchy Veggies',
      emoji: '🥦',
      foods: 'Broccoli, carrots, spinach & peas',
      help: 'Body Defender & Eye Helper',
      color: '#DCEED2',
      superpower:
        'Loaded with Vitamins A, K, and minerals that keep your eyes sharp, bones strong, and immune shield active!',
    },
    {
      group: 'grain',
      title: 'Golden Whole Grains',
      emoji: '🌾',
      foods: 'Oatmeal, pancakes, rice & whole-wheat bread',
      help: 'Brain & Running Fuel',
      color: '#FFE0B8',
      superpower:
        'Provides steady complex carbohydrates and B-vitamins that fuel your brain for school and muscles for playtime!',
    },
    {
      group: 'protein',
      title: 'Mighty Proteins',
      emoji: '🍗',
      foods: 'Eggs, chicken, fish, beans & nuts',
      help: 'Muscle Builder',
      color: '#E3D8ED',
      superpower:
        'Rich in amino acids and iron that build strong muscles and help your body grow taller and recover fast!',
    },
    {
      group: 'dairy',
      title: 'Creamy Dairy & Calcium',
      emoji: '🥛',
      foods: 'Milk, yogurt & cheese',
      help: 'Bone & Teeth Shield',
      color: '#D6EEF8',
      superpower:
        'High in calcium, Vitamin D, and probiotics for super-strong bones, healthy teeth, and a happy tummy!',
    },
    {
      group: 'treat',
      title: 'Fun Sometimes Treats',
      emoji: '🧁',
      foods: 'Sweet snacks, cookies & desserts',
      help: 'Joyful Sometimes Food',
      color: '#FBE0EC',
      superpower:
        'Enjoyed in small portions alongside water and everyday foods for a balanced, happy relationship with food!',
    },
  ]

  const unlockedGroupsCount = rainbowCards.filter((c) => (groupCounts[c.group] || 0) > 0).length
  const totalPoints = logs.length * 15
  const avgHealthScore = logs.length
    ? Math.round(logs.reduce((s, l) => s + l.score, 0) / logs.length)
    : lastScan?.score || 0

  const activeGroupDetail = rainbowCards.find((c) => c.group === selectedGroup)

  return (
    <>
      <section className="foodfriends-sky relative overflow-hidden rounded-[34px] border-4 border-white bg-[#9DE8F5] px-6 py-8 shadow-[0_8px_0_#B8E4A0] sm:px-10 sm:py-10">
        <div className="relative z-10 max-w-[610px]">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/85 px-3.5 py-2 text-xs font-extrabold uppercase tracking-wider text-[#254336] shadow-xs">
            <span className="h-2 w-2 rounded-full bg-[#34A853] animate-pulse" />
            Today&apos;s food adventure • {logs.length} {logs.length === 1 ? 'food' : 'foods'} logged
          </div>
          <h1 className="text-[2.5rem] font-black leading-[.98] tracking-[-.055em] text-[#173C4A] sm:text-[4rem]">
            Hey {user?.displayName ?? 'explorer'},<br />
            <span className="text-[#E64F70]">ready to discover?</span>
          </h1>
          <p className="mt-5 max-w-lg text-base font-semibold leading-relaxed text-[#254A56] sm:text-lg">
            Scan your meal or snack, see its estimated portion and nutrition facts, and build your
            6-color rainbow plate with Bananini!
          </p>

          {lastScan && (
            <div className="mt-5 inline-flex flex-wrap items-center gap-3 rounded-2xl border-2 border-white bg-white/90 px-4 py-2.5 shadow-sm">
              <span className="text-xl">🍽️</span>
              <div className="text-xs">
                <p className="font-black text-[#173C4A]">
                  Active Scan: {lastScan.name} ({lastScan.score}/100)
                </p>
                <p className="font-semibold text-[#50695A]">
                  {lastScan.estimatedPortion} • {lastScan.nutrients.calories} kcal
                </p>
              </div>
              <button
                onClick={() => navigate('scan')}
                className="rounded-xl bg-[#287A52] px-3 py-1.5 text-xs font-black text-white transition hover:bg-[#1e6040]"
              >
                Open Scan →
              </button>
            </div>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            <Button onClick={() => navigate('scan')}>
              <Icon name="scan" />
              Scan my food
            </Button>
            <Button tone="white" onClick={() => navigate('log')}>
              <Icon name="book" />
              Explorer Log ({logs.length})
            </Button>
            <Button tone="white" onClick={() => navigate('learn')}>
              Play & learn
              <Icon name="arrow" />
            </Button>
          </div>
        </div>
        <div className="relative -mb-14 -mr-8 mt-4 flex justify-end sm:absolute sm:-bottom-5 sm:right-5 sm:mb-0 sm:mr-0">
          <Bananini />
        </div>
      </section>

      <section className="mt-7 grid gap-5 md:grid-cols-[1.3fr_.7fr]">
        <div className="rounded-[30px] border border-[#E0E5DA] bg-white p-6 sm:p-7">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#7B897F]">
                Quick adventure
              </p>
              <h2 className="mt-1 text-2xl font-black tracking-tight">
                What would you like to do?
              </h2>
            </div>
            <span className="hidden rounded-full bg-[#FFF3BA] px-3 py-2 text-xs font-extrabold text-[#5C4813] sm:block">
              +15 pts per scan
            </span>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ActionCard
              icon="camera"
              title="Food Scanner"
              copy={lastScan ? `Active: ${lastScan.name}` : 'Snap or upload a food'}
              color="#E3F2D4"
              onClick={() => navigate('scan')}
            />
            <ActionCard
              icon="book"
              title="Explorer Log"
              copy={`${logs.length} saved food ${logs.length === 1 ? 'entry' : 'entries'}`}
              color="#FBE5C8"
              onClick={() => navigate('log')}
            />
            <ActionCard
              icon="learn"
              title="Mini Quiz"
              copy="Test your food smarts"
              color="#FFF0BC"
              onClick={() => navigate('learn')}
            />
            <ActionCard
              icon="chat"
              title="Ask Bananini"
              copy="AI nutrition chatbot"
              color="#DCEBF1"
              onClick={() => navigate('chat')}
            />
          </div>
        </div>

        {/* LIVE WEEKLY PROGRESS & STATS CARD */}
        <div className="rounded-[30px] border-4 border-white bg-[#6C53C7] p-6 text-white shadow-[0_7px_0_#4D399D] sm:p-7 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#B9D3C2]">
                  Your live progress
                </p>
                <h2 className="mt-1 text-2xl font-black">
                  {logs.length > 0 ? 'Awesome exploring!' : 'Start your streak!'}
                </h2>
              </div>
              <button
                onClick={() => navigate('log')}
                title="View Explorer Log"
                className="grid h-11 w-11 place-items-center rounded-2xl bg-[#FFD84D] text-[#3D2A1E] transition hover:scale-105"
              >
                <Icon name="star" />
              </button>
            </div>

            <div className="mt-6 flex items-end justify-between gap-1">
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => {
                const isDone = activeWeekDays.has(i)
                const isToday = i === currentDayIndex
                return (
                  <div key={`${day}${i}`} className="flex flex-col items-center gap-2">
                    <span
                      className={`grid h-8 w-8 place-items-center rounded-full text-xs font-black transition ${
                        isDone
                          ? 'bg-[#72B989] text-white shadow-sm'
                          : isToday
                            ? 'border-2 border-[#FFD84D] bg-white/15 text-[#FFD84D]'
                            : 'bg-white/10 text-white/45'
                      }`}
                    >
                      {isDone ? <Icon name="check" size={15} /> : isToday ? '•' : ''}
                    </span>
                    <span
                      className={`text-[10px] font-bold ${
                        isToday ? 'text-[#FFD84D] font-black' : 'text-white/60'
                      }`}
                    >
                      {day}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-center">
            <div>
              <strong className="block text-lg font-black text-white">{totalPoints}</strong>
              <span className="text-[10px] font-bold uppercase text-white/70">Points</span>
            </div>
            <div>
              <strong className="block text-lg font-black text-[#FFD84D]">{logs.length}</strong>
              <span className="text-[10px] font-bold uppercase text-white/70">Logged</span>
            </div>
            <div>
              <strong className="block text-lg font-black text-[#8BF0A8]">
                {avgHealthScore || '—'}
              </strong>
              <span className="text-[10px] font-bold uppercase text-white/70">Avg Score</span>
            </div>
          </div>
        </div>
      </section>

      {/* INTERACTIVE RAINBOW PLATE TRACKER */}
      <section className="mt-7 rounded-[30px] border border-[#E0E5DA] bg-white p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#7B897F]">
              Interactive Rainbow Tracker ({unlockedGroupsCount} / 6 Groups Unlocked)
            </p>
            <h2 className="mt-1 text-2xl font-black">Build a rainbow plate</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 rounded-full bg-[#F1F6EE] px-3.5 py-1.5 text-xs font-black text-[#287A52]">
              <span>🌈 Progress:</span>
              <span>{Math.round((unlockedGroupsCount / 6) * 100)}%</span>
            </div>
            <button
              onClick={() => navigate('scan')}
              className="rounded-full bg-[#287A52] px-4 py-2 text-xs font-black text-white transition hover:bg-[#1f6241]"
            >
              + Scan a Food Group
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rainbowCards.map((card) => {
            const count = groupCounts[card.group] || 0
            const isSelected = selectedGroup === card.group
            return (
              <button
                key={card.group}
                type="button"
                onClick={() =>
                  setSelectedGroup((prev) => (prev === card.group ? null : card.group))
                }
                className={`rounded-2xl p-4 text-left transition hover:-translate-y-0.5 ${
                  isSelected ? 'ring-3 ring-[#287A52] shadow-md' : ''
                }`}
                style={{ backgroundColor: card.color }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl">{card.emoji}</span>
                  {count > 0 ? (
                    <span className="rounded-full bg-[#287A52] px-2.5 py-0.5 text-[10px] font-black uppercase text-white">
                      ✓ {count} Logged
                    </span>
                  ) : (
                    <span className="rounded-full bg-white/75 px-2.5 py-0.5 text-[10px] font-extrabold uppercase text-[#5E6D63]">
                      Not logged yet
                    </span>
                  )}
                </div>
                <p className="mt-2 font-black text-base text-[#173C4A]">{card.title}</p>
                <p className="mt-1 text-xs font-semibold text-[#54635A]">{card.foods}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[11px] font-extrabold uppercase tracking-wide text-[#254336]">
                    {card.help}
                  </span>
                  <span className="text-xs font-black text-[#287A52]">
                    {isSelected ? 'Hide ▲' : 'Explore ▼'}
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* EXPANDED FOOD GROUP SUPERPOWER PANEL */}
        {activeGroupDetail && (
          <div className="mt-4 flex flex-col justify-between gap-4 rounded-2xl border-2 border-[#CDE8D5] bg-[#F5FBF6] p-5 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{activeGroupDetail.emoji}</span>
                <h3 className="text-lg font-black text-[#173C4A]">{activeGroupDetail.title}</h3>
                <span className="rounded-full bg-[#DDEFC8] px-2.5 py-0.5 text-xs font-black text-[#255433]">
                  {activeGroupDetail.help}
                </span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-relaxed text-[#425A4D]">
                {activeGroupDetail.superpower}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  onAskBananini(
                    `Hi Bananini! What are the best ${activeGroupDetail.title.toLowerCase()} for kids and what superpowers do they give?`
                  )
                }
                className="rounded-xl bg-[#FFD84D] px-4 py-2.5 text-xs font-black text-[#3D2A1E] shadow-xs transition hover:bg-[#f6cc36]"
              >
                🍌 Ask Bananini
              </button>
              <button
                type="button"
                onClick={() => navigate('scan')}
                className="rounded-xl bg-[#287A52] px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-[#1e6040]"
              >
                📷 Scan This Group
              </button>
            </div>
          </div>
        )}
      </section>

      {/* LIVE RECENT SCANS SECTION ON HOME PAGE */}
      <section className="mt-7 rounded-[30px] border border-[#E0E5DA] bg-white p-6 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[.16em] text-[#7B897F]">
              Live Activity
            </p>
            <h2 className="mt-1 text-2xl font-black">Recent food discoveries</h2>
          </div>
          <button
            onClick={() => navigate('log')}
            className="text-sm font-extrabold text-[#287A52] hover:underline"
          >
            Open full Explorer Log →
          </button>
        </div>

        {loadingLogs ? (
          <p className="mt-4 text-sm font-bold text-[#7B897F]">Loading your recent discoveries...</p>
        ) : logs.length === 0 ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#F4FAF6] p-5 border border-[#DCEADF]">
            <div>
              <p className="font-black text-[#173C4A]">No saved foods in your Explorer Log yet!</p>
              <p className="mt-1 text-xs font-semibold text-[#607166]">
                Scan a meal or snack and click &ldquo;Save to My Explorer Log&rdquo; to track your
                rainbow plate here.
              </p>
            </div>
            <Button onClick={() => navigate('scan')}>
              <Icon name="scan" />
              Scan Your First Food
            </Button>
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {logs.slice(0, 3).map((item) => (
              <div
                key={item.id}
                className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[#E2EAE0] bg-[#FAFDF9] p-4 shadow-2xs"
              >
                <div>
                  {item.image_url && (
                    <div className="mb-3 h-36 w-full overflow-hidden rounded-xl border border-[#DCE8DD] bg-[#111C16]">
                      <img
                        src={item.image_url}
                        alt={item.food_name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full bg-[#E6F4EA] px-2.5 py-0.5 text-[10px] font-black uppercase text-[#287A52]">
                      {item.food_group}
                    </span>
                    <span className="rounded-lg bg-[#287A52] px-2 py-0.5 text-xs font-black text-white">
                      {item.score}/100
                    </span>
                  </div>
                  <h3 className="mt-2.5 text-base font-black capitalize text-[#173C4A]">
                    {item.food_name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs font-semibold text-[#5E6E64]">
                    {item.summary}
                  </p>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-[#EBF0E9] pt-3">
                  <span className="text-[11px] font-bold text-[#829187]">
                    {new Date(item.created_at).toLocaleDateString()}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onAskBananini(
                        `Hi Bananini! Tell me more about ${item.food_name} (${item.food_group}) and how it helps my body!`
                      )
                    }
                    className="text-xs font-black text-[#287A52] hover:underline"
                  >
                    🍌 Ask Bananini →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function ActionCard({
  icon,
  title,
  copy,
  color,
  onClick,
}: {
  icon: IconName
  title: string
  copy: string
  color: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="group rounded-[22px] p-4 text-left transition hover:-translate-y-1"
      style={{ backgroundColor: color }}
    >
      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/75">
        <Icon name={icon} />
      </span>
      <p className="mt-5 font-black">{title}</p>
      <p className="mt-1 text-xs font-semibold text-[#68756D]">{copy}</p>
      <span className="mt-4 inline-flex text-[#287A52] transition group-hover:translate-x-1">
        <Icon name="arrow" size={18} />
      </span>
    </button>
  )
}

function compressFoodImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const maxW = 380
      const maxH = 285
      let w = img.width || maxW
      let h = img.height || maxH
      if (w > maxW) {
        h = Math.round((h * maxW) / w)
        w = maxW
      }
      if (h > maxH) {
        w = Math.round((w * maxH) / h)
        h = maxH
      }
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/jpeg', 0.72))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

function Scanner({
  user,
  onSignIn,
  scanState,
  onUpdateScanState,
  onStatsChange,
  onAskBananini,
}: {
  user: PublicUser | null
  onSignIn: () => void
  scanState: {
    photo: string | null
    photoBase64: string | null
    photoMime: string
    result: FoodAnalysis | null
    saved?: boolean
  }
  onUpdateScanState: React.Dispatch<
    React.SetStateAction<{
      photo: string | null
      photoBase64: string | null
      photoMime: string
      result: FoodAnalysis | null
      saved?: boolean
    }>
  >
  onStatsChange?: (points: number, streak: number) => void
  onAskBananini: (foodName: string) => void
}) {
  const { photo, photoBase64, photoMime, result, saved } = scanState
  const [scanning, setScanning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showNutrition, setShowNutrition] = useState(true)
  const [saveMessage, setSaveMessage] = useState('')
  const [scanError, setScanError] = useState('')
  const [cameraActive, setCameraActive] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start live camera
  const startCamera = async () => {
    try {
      setScanError('')
      stopCamera()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
      onUpdateScanState((prev) => ({
        ...prev,
        photo: null,
        photoBase64: null,
        result: null,
      }))
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play().catch(() => {})
        }
      }, 100)
    } catch {
      setScanError('Could not access camera. Please allow camera permissions or upload an image file.')
    }
  }

  // Stop camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setCameraActive(false)
  }

  // Snap photo from live camera
  const captureFromCamera = () => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 1280
    canvas.height = video.videoHeight || 720
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
    const rawBase64 = dataUrl.split(',')[1]

    onUpdateScanState({
      photo: dataUrl,
      photoBase64: rawBase64,
      photoMime: 'image/jpeg',
      result: null,
      saved: false,
    })
    stopCamera()
    setScanError('')
    setSaveMessage('')
  }

  // Pick file from device
  const pickPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    stopCamera()
    setScanError('')
    setSaveMessage('')

    const mime = file.type || 'image/jpeg'
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const rawBase64 = dataUrl.split(',')[1]
      onUpdateScanState({
        photo: dataUrl,
        photoBase64: rawBase64,
        photoMime: mime,
        result: null,
        saved: false,
      })
    }
    reader.readAsDataURL(file)
  }

  // Main scan function - uses Gemini AI Vision autonomously
  const scan = async () => {
    if (!photoBase64 && !photo) return
    setScanning(true)
    setScanError('')
    setSaveMessage('')

    try {
      if (photoBase64) {
        const res = await analyzeFoodAction(photoBase64, photoMime)
        if (res.ok) {
          onUpdateScanState((prev) => ({ ...prev, result: res.data, saved: false }))
          setScanning(false)
          return
        } else {
          setScanError(res.error)
        }
      }

      // Fallback only if model unreachable
      await new Promise((r) => setTimeout(r, 900))
      const fallback = resultFor('Fresh Food')
      onUpdateScanState((prev) => ({ ...prev, result: fallback, saved: false }))
    } catch {
      setScanError('Could not analyze the photo. Please try again.')
    } finally {
      setScanning(false)
    }
  }

  const save = async () => {
    if (!result || saved || saving) return
    if (!user) {
      onSignIn()
      return
    }
    setSaving(true)
    setSaveMessage('')
    try {
      const imageDataUrl = photo ? await compressFoodImage(photo) : undefined
      const response = await saveScanAction({
        foodGroup: result.group,
        foodName: result.name,
        score: result.score,
        summary: result.summary,
        imageDataUrl,
      })
      if (response.ok) {
        onUpdateScanState((prev) => ({ ...prev, saved: true }))
        onStatsChange?.(response.data.points, response.data.streak)
        setSaveMessage('✅ Saved with photo to your Explorer Log (+15 pts)!')
      } else {
        setSaveMessage(response.error)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#CFF2A9] px-4 py-1.5 text-xs font-black uppercase tracking-wider text-[#2D5A34]">
          <span className="h-2 w-2 rounded-full bg-[#34A853] animate-pulse" />
          AI Food & Portion Scanner
        </span>
        <h1 className="mt-3 text-3xl font-black tracking-[-.04em] text-[#254336] sm:text-5xl">
          What&apos;s on your plate?
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-sm font-semibold text-[#6B7A70]">
          Take a photo or upload an image. Bananini automatically detects the food, estimates
          the portion size, and calculates exact nutrition!
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 items-start">
        {/* LEFT PANEL: Camera / Image Uploader (Bounded Height) */}
        <section className="flex flex-col justify-between rounded-[30px] border-4 border-white bg-[#F9FEFF] p-5 shadow-[0_8px_0_#B8E9F1] sm:p-6 lg:h-[600px]">
          <input
            ref={fileRef}
            onChange={pickPhoto}
            type="file"
            accept="image/*"
            className="hidden"
          />

          {/* Viewport: Live Camera OR Photo Preview OR Empty Placeholder */}
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[24px] border-4 border-[#58CF70] bg-[#111C16]">
            {cameraActive ? (
              /* REAL LIVE CAMERA VIEWFINDER */
              <div className="relative h-full w-full bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full object-cover"
                />

                {/* Viewfinder focus brackets overlay */}
                <div className="pointer-events-none absolute inset-8 flex items-center justify-center">
                  <div className="relative h-full w-full max-w-[280px] max-h-[220px] rounded-2xl border-2 border-dashed border-white/60">
                    <span className="absolute -top-1 -left-1 h-4 w-4 border-t-2 border-l-2 border-[#FFD84D]" />
                    <span className="absolute -top-1 -right-1 h-4 w-4 border-t-2 border-r-2 border-[#FFD84D]" />
                    <span className="absolute -bottom-1 -left-1 h-4 w-4 border-b-2 border-l-2 border-[#FFD84D]" />
                    <span className="absolute -bottom-1 -right-1 h-4 w-4 border-b-2 border-r-2 border-[#FFD84D]" />
                  </div>
                </div>

                {/* Top Camera Controls */}
                <div className="absolute top-3 inset-x-3 flex items-center justify-between z-10">
                  <span className="flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-black text-white backdrop-blur">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-ping" />
                    LIVE VIEW
                  </span>
                  <button
                    onClick={stopCamera}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white font-black hover:bg-black/80"
                  >
                    ✕
                  </button>
                </div>

                {/* Bottom Camera Shutter Button */}
                <div className="absolute inset-x-0 bottom-4 flex flex-col items-center justify-center gap-2 z-10">
                  <button
                    onClick={captureFromCamera}
                    title="Take Photo"
                    className="group flex h-16 w-16 items-center justify-center rounded-full border-4 border-white bg-black/30 backdrop-blur transition active:scale-95 shadow-xl"
                  >
                    <span className="h-11 w-11 rounded-full bg-white group-hover:bg-[#FFD84D] transition shadow-inner" />
                  </button>
                  <span className="rounded-full bg-black/50 px-3 py-0.5 text-[10px] font-black text-white/90">
                    Tap to snap photo
                  </span>
                </div>
              </div>
            ) : photo ? (
              /* Photo Preview */
              <div className="relative h-full w-full bg-[#111C16]">
                <img
                  src={photo}
                  alt="Food ready to scan"
                  className="h-full w-full object-contain"
                />
                <button
                  onClick={() => {
                    onUpdateScanState({
                      photo: null,
                      photoBase64: null,
                      photoMime: 'image/jpeg',
                      result: null,
                    })
                  }}
                  className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1.5 text-xs font-black text-white hover:bg-black/90 shadow"
                >
                  ✕ Change
                </button>
              </div>
            ) : (
              /* Initial State */
              <div className="grid h-full place-items-center bg-[#D9F6FA] p-6 text-center">
                <div>
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#FFD84D] text-2xl shadow-sm">
                    🍌
                  </span>
                  <p className="mt-3 text-base font-black text-[#254336]">
                    Show Bananini your food!
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#7A887D]">
                    Open live camera or choose a photo
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                    <button
                      onClick={startCamera}
                      className="inline-flex items-center gap-2 rounded-2xl bg-[#58CF70] px-4 py-2.5 text-xs font-black text-white shadow transition hover:bg-[#48b95e] active:scale-95"
                    >
                      📷 Open Camera
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-[#254336] shadow transition hover:bg-[#F0F5F1] active:scale-95"
                    >
                      📁 Upload Photo
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Quick buttons under photo */}
          {photo && !cameraActive && (
            <div className="mt-2.5 flex justify-between gap-2 text-xs">
              <button
                onClick={startCamera}
                className="font-black text-[#347384] hover:underline"
              >
                📷 Switch to Live Camera
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                className="font-black text-[#347384] hover:underline"
              >
                📁 Choose Different Photo
              </button>
            </div>
          )}

          {scanError && (
            <div className="mt-2.5 rounded-2xl bg-rose-100 p-3 text-xs font-black text-rose-800">
              ⚠️ {scanError}
            </div>
          )}

          <Button
            onClick={scan}
            disabled={(!photo && !photoBase64) || scanning}
            className="mt-4 w-full text-base font-black"
          >
            {scanning ? (
              <span className="flex items-center gap-2">
                <span className="inline-block animate-spin">🌀</span> Bananini is analyzing...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                🔍 Discover Food Superpowers
              </span>
            )}
          </Button>
        </section>

        {/* RIGHT PANEL: AI Result, Portion Estimate & Internal Scroll Pane */}
        <section className="flex flex-col justify-between rounded-[30px] border-4 border-white bg-[#9DE8F5] p-5 sm:p-6 text-[#173C4A] shadow-[0_8px_0_#72C9D8] lg:h-[600px] overflow-hidden">
          {scanning ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="scan-orbit mx-auto grid h-24 w-24 place-items-center rounded-full border-4 border-[#FFD84D] bg-white/40">
                  <span className="text-3xl animate-bounce">🍌</span>
                </div>
                <h2 className="mt-5 text-2xl font-black text-[#173C4A]">Analyzing Photo...</h2>
                <p className="mt-2 text-xs font-semibold text-[#365F6B]">
                  Identifying food, estimating portion size, and calculating exact nutrition!
                </p>
              </div>
            </div>
          ) : result ? (
            <>
              {/* INTERNAL SCROLLABLE CONTENT (Does not stretch screen!) */}
              <div className="flex-1 min-h-0 overflow-y-auto pr-2 space-y-3.5">
                {/* Top Bar: Group Badge + Health Score */}
                <div className="flex items-start justify-between">
                  <div>
                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black uppercase tracking-wider text-[#254336] shadow-xs">
                      {result.group === 'fruit' && '🍎 Fruit'}
                      {result.group === 'vegetable' && '🥦 Vegetable'}
                      {result.group === 'protein' && '🍗 Protein'}
                      {result.group === 'grain' && '🌾 Whole Grain'}
                      {result.group === 'dairy' && '🥛 Dairy'}
                      {result.group === 'treat' && '🧁 Treat'}
                    </span>
                    <p className="mt-2 text-[10px] font-black uppercase tracking-[.18em] text-[#2F616F]">
                      Bananini discovered
                    </p>
                    <h2 className="text-2xl sm:text-3xl font-black capitalize tracking-tight text-[#173C4A]">
                      {result.name}
                    </h2>
                  </div>

                  <div className="text-center">
                    <div
                      className="grid h-14 w-14 place-items-center rounded-2xl text-xl font-black text-white shadow-sm"
                      style={{ backgroundColor: result.color }}
                    >
                      {result.score}
                    </div>
                    <span className="mt-1 block text-[9px] font-black uppercase text-[#2F616F]">
                      Health Score
                    </span>
                  </div>
                </div>

                {/* ESTIMATED PORTION CARD */}
                <div className="flex items-center gap-3 rounded-2xl bg-white/90 p-3 shadow-xs border border-white">
                  <span className="text-2xl">🍽️</span>
                  <div>
                    <span className="block text-[10px] font-black uppercase tracking-wider text-[#347384]">
                      Estimated Portion in Picture
                    </span>
                    <span className="text-sm font-black text-[#173C4A]">
                      {result.estimatedPortion}
                    </span>
                  </div>
                </div>

                {/* Summary */}
                <p className="text-xs font-semibold leading-relaxed text-[#254A56]">
                  {result.summary}
                </p>

                {/* Explanation */}
                {result.explanation && (
                  <div className="rounded-2xl bg-white/70 p-3 text-xs font-medium leading-relaxed text-[#1D3E4A]">
                    <strong className="block font-black text-xs mb-1 text-[#173C4A]">
                      🧠 Bananini&apos;s Breakdown:
                    </strong>
                    {result.explanation}
                  </div>
                )}

                {/* Detailed Nutrition Panel */}
                <div className="rounded-[22px] bg-[#FFFDF5] p-3.5 shadow-xs text-[#254336]">
                  <div className="flex items-center justify-between border-b border-[#F0EBD6] pb-2">
                    <div>
                      <h3 className="font-black text-xs">🥗 Nutrition Facts</h3>
                      <p className="text-[10px] font-bold text-[#7A887D]">
                        Calculated for {result.estimatedPortion || 'portion in photo'}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowNutrition(!showNutrition)}
                      className="text-[11px] font-black text-[#347384] hover:underline"
                    >
                      {showNutrition ? 'Collapse ▲' : 'Expand ▼'}
                    </button>
                  </div>

                  {showNutrition && (
                    <div className="mt-2.5 space-y-2">
                      {/* Primary macros grid */}
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="rounded-xl bg-[#F7F5EB] p-2">
                          <span className="block text-[9px] font-extrabold uppercase text-[#7A887D]">
                            Calories
                          </span>
                          <span className="text-xs font-black text-[#254336]">
                            {result.nutrients?.calories || '—'}
                          </span>
                        </div>
                        <div className="rounded-xl bg-[#F7F5EB] p-2">
                          <span className="block text-[9px] font-extrabold uppercase text-[#7A887D]">
                            Protein
                          </span>
                          <span className="text-xs font-black text-[#E99D55]">
                            {result.nutrients?.protein || '—'}
                          </span>
                        </div>
                        <div className="rounded-xl bg-[#F7F5EB] p-2">
                          <span className="block text-[9px] font-extrabold uppercase text-[#7A887D]">
                            Fiber
                          </span>
                          <span className="text-xs font-black text-[#65A968]">
                            {result.nutrients?.fiber || '—'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5 text-center text-xs">
                        <div className="rounded-xl bg-white p-1.5">
                          <span className="block text-[9px] font-bold text-[#7A887D]">Carbs</span>
                          <span className="font-black text-xs">{result.nutrients?.carbs || '—'}</span>
                        </div>
                        <div className="rounded-xl bg-white p-1.5">
                          <span className="block text-[9px] font-bold text-[#7A887D]">Fat</span>
                          <span className="font-black text-xs">{result.nutrients?.fat || '—'}</span>
                        </div>
                        <div className="rounded-xl bg-white p-1.5">
                          <span className="block text-[9px] font-bold text-[#7A887D]">Sugar</span>
                          <span className="font-black text-xs">{result.nutrients?.sugar || '—'}</span>
                        </div>
                      </div>

                      {/* Key Vitamins & Minerals */}
                      {((result.nutrients?.vitamins && result.nutrients.vitamins.length > 0) ||
                        (result.nutrients?.minerals && result.nutrients.minerals.length > 0)) && (
                        <div className="border-t border-[#F0EBD6] pt-2">
                          <span className="block text-[10px] font-black uppercase tracking-wider text-[#7A887D] mb-1">
                            Key Micronutrients:
                          </span>
                          <div className="flex flex-wrap gap-1">
                            {result.nutrients.vitamins?.map((vit) => (
                              <span
                                key={vit}
                                className="rounded-lg bg-[#E8F8EA] px-2 py-0.5 text-[10px] font-black text-[#2D6633]"
                              >
                                ✨ {vit}
                              </span>
                            ))}
                            {result.nutrients.minerals?.map((min) => (
                              <span
                                key={min}
                                className="rounded-lg bg-[#EBF4FA] px-2 py-0.5 text-[10px] font-black text-[#2A5980]"
                              >
                                ⚡ {min}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Fun Fact */}
                {result.funFact && (
                  <div className="rounded-2xl bg-[#FFF6D6] p-3 text-xs font-semibold text-[#57441B] flex items-start gap-2">
                    <span className="text-base">💡</span>
                    <div>
                      <strong className="block font-black">Did you know?</strong>
                      {result.funFact}
                    </div>
                  </div>
                )}

                {/* Tip */}
                {result.tip && (
                  <div className="rounded-2xl bg-[#E6F8ED] p-3 text-xs font-semibold text-[#255C39] flex items-start gap-2">
                    <span className="text-base">🥦</span>
                    <div>
                      <strong className="block font-black">Bananini&apos;s Tip:</strong>
                      {result.tip}
                    </div>
                  </div>
                )}
              </div>

              {/* PINNED BOTTOM ACTION BAR */}
              <div className="pt-3 border-t border-[#72C9D8]/50 space-y-2 mt-2">
                <Button
                  tone={saved ? 'white' : 'yellow'}
                  onClick={save}
                  disabled={Boolean(saved) || saving}
                  className="w-full text-sm font-black"
                >
                  {!user
                    ? '🔒 Sign in to Save Scan'
                    : saving
                      ? '💾 Saving to Explorer Log...'
                      : saved
                        ? '✅ Saved to My Explorer Log'
                        : '⭐ Save to My Explorer Log (+15 pts)'}
                </Button>
                <button
                  type="button"
                  onClick={() => onAskBananini(result.name)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-[#173C4A]/20 bg-white px-4 py-2.5 text-xs font-black text-[#173C4A] shadow-xs transition hover:bg-[#F0FBFC] active:scale-95"
                >
                  <span className="text-sm">💬</span>
                  <span>Ask Bananini About This Food</span>
                </button>
                {saveMessage && (
                  <p className="text-center text-xs font-black text-[#173C4A]" role="status">
                    {saveMessage}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center">
              <div>
                <Bananini small />
                <h2 className="mt-4 text-2xl font-black text-[#173C4A]">Ready to scan!</h2>
                <p className="mx-auto mt-2 max-w-xs text-xs font-semibold leading-relaxed text-[#365F6B]">
                  Take a photo with the live camera or upload a picture. Bananini will read the
                  food, estimate portion size, and calculate its nutrition powers!
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ExplorerLogView({
  user,
  onSignIn,
  onScanMore,
  onStatsChange,
  onAskBananini,
}: {
  user: PublicUser | null
  onSignIn: () => void
  onScanMore: () => void
  onStatsChange?: (points: number, streak: number) => void
  onAskBananini: (foodName: string) => void
}) {
  const [logs, setLogs] = useState<FoodLogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string>('')

  useEffect(() => {
    if (user) {
      setLoading(true)
      getFoodLogsAction().then((res) => {
        if (res.ok) setLogs(res.data)
        setLoading(false)
      })
    } else {
      setLoading(false)
    }
  }, [user])

  const handleDelete = async (logId: string, foodName: string) => {
    setDeletingId(logId)
    setFeedback('')
    const res = await deleteUserFoodLogAction(logId)
    if (res.ok) {
      setLogs((prev) => prev.filter((item) => item.id !== logId))
      onStatsChange?.(res.data.points, res.data.streak)
      setConfirmDeleteId(null)
      setFeedback(`🗑️ Removed "${foodName}" from your Explorer Log.`)
    } else {
      setFeedback(`⚠️ ${res.error}`)
    }
    setDeletingId(null)
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-xl rounded-[32px] border border-[#E0E5DB] bg-white p-8 text-center sm:p-12 shadow-sm">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#FFF0B9] text-3xl">
          📖
        </span>
        <h1 className="mt-6 text-3xl font-black text-[#173C4A]">Explorer Food Log</h1>
        <p className="mt-3 font-semibold text-[#6B7970]">
          Sign in to view all the healthy foods you’ve discovered and saved on your explorer journey!
        </p>
        <Button onClick={onSignIn} className="mt-7 font-black">
          Sign In to Access Your Log
        </Button>
      </div>
    )
  }

  const filtered = logs.filter((item) => {
    const matchGroup = selectedGroup === 'all' || item.food_group === selectedGroup
    const matchSearch =
      !search ||
      item.food_name.toLowerCase().includes(search.toLowerCase()) ||
      item.summary.toLowerCase().includes(search.toLowerCase())
    return matchGroup && matchSearch
  })

  // Group statistics
  const distinctGroups = new Set(logs.map((l) => l.food_group)).size
  const avgScore =
    logs.length > 0 ? Math.round(logs.reduce((acc, l) => acc + l.score, 0) / logs.length) : 0

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#CFF2A9] px-3.5 py-1 text-xs font-black uppercase tracking-wider text-[#2D5A34]">
            📖 Food Journal
          </span>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-[#173C4A] sm:text-4xl">
            My Explorer Log
          </h1>
          <p className="text-sm font-semibold text-[#6B7A70]">
            Every healthy food and superpower you&apos;ve scanned and saved.
          </p>
        </div>
        <Button onClick={onScanMore} className="self-start sm:self-auto font-black">
          <Icon name="scan" />
          Scan New Food
        </Button>
      </div>

      {/* Summary Stats Cards */}
      <div className="grid grid-cols-3 gap-3 sm:gap-5">
        <div className="rounded-[24px] border border-[#E0E5DA] bg-white p-4 sm:p-5 shadow-xs text-center">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#7A887D]">Total Scans</span>
          <p className="mt-1 text-2xl sm:text-3xl font-black text-[#173C4A]">{logs.length}</p>
        </div>
        <div className="rounded-[24px] border border-[#E0E5DA] bg-white p-4 sm:p-5 shadow-xs text-center">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#7A887D]">Rainbow Variety</span>
          <p className="mt-1 text-2xl sm:text-3xl font-black text-[#287A52]">{distinctGroups} / 6 Groups</p>
        </div>
        <div className="rounded-[24px] border border-[#E0E5DA] bg-white p-4 sm:p-5 shadow-xs text-center">
          <span className="text-[11px] font-black uppercase tracking-wider text-[#7A887D]">Average Score</span>
          <p className="mt-1 text-2xl sm:text-3xl font-black text-[#E99D55]">{avgScore ? `${avgScore}/100` : '—'}</p>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Category Filter Pills */}
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'all', label: 'All Foods' },
            { id: 'fruit', label: '🍎 Fruit' },
            { id: 'vegetable', label: '🥦 Veggie' },
            { id: 'protein', label: '🍗 Protein' },
            { id: 'grain', label: '🌾 Grain' },
            { id: 'dairy', label: '🥛 Dairy' },
            { id: 'treat', label: '🧁 Treat' },
          ].map((cat) => (
            <button
              key={cat.id}
              onClick={() => setSelectedGroup(cat.id)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-black transition ${
                selectedGroup === cat.id
                  ? 'bg-[#173C4A] text-white shadow-xs'
                  : 'bg-white text-[#506357] hover:bg-[#EAF3EA] border border-[#DCE4D9]'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Search Box */}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search saved foods..."
          className="h-10 rounded-xl border border-[#D9E1D6] bg-white px-3.5 text-xs font-bold outline-none focus:border-[#62A278] sm:w-56"
        />
      </div>

      {feedback && (
        <div className="flex items-center justify-between rounded-2xl border border-[#DCE8DD] bg-white px-4 py-3 text-xs font-black text-[#173C4A] shadow-2xs">
          <span>{feedback}</span>
          <button
            type="button"
            onClick={() => setFeedback('')}
            className="text-xs font-extrabold text-[#6E7D73] hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Food Log Cards Grid */}
      {loading ? (
        <div className="rounded-[28px] bg-white p-12 text-center text-sm font-black text-[#7D8C81]">
          Loading your explorer log...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[30px] border border-dashed border-[#CFD9CC] bg-white/70 p-12 text-center">
          <span className="text-4xl">🥗</span>
          <h3 className="mt-3 text-lg font-black text-[#173C4A]">
            {logs.length === 0 ? 'No foods saved yet!' : 'No matching foods found'}
          </h3>
          <p className="mt-1 text-xs font-semibold text-[#6E7D73]">
            {logs.length === 0
              ? 'Head over to the Scan tab to scan your first meal and save it to your log.'
              : 'Try selecting a different food group or clearing your search filter.'}
          </p>
          {logs.length === 0 && (
            <Button onClick={onScanMore} className="mt-5 font-black">
              Start Scanning
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const isConfirming = confirmDeleteId === item.id
            const isDeleting = deletingId === item.id
            return (
              <div
                key={item.id}
                className="flex flex-col justify-between overflow-hidden rounded-[26px] border border-[#E3EAE0] bg-white p-5 shadow-xs transition hover:border-[#287A52]/40 hover:shadow-sm"
              >
                <div>
                  {item.image_url && (
                    <div className="mb-3.5 h-44 w-full overflow-hidden rounded-2xl border border-[#DCE8DD] bg-[#111C16]">
                      <img
                        src={item.image_url}
                        alt={item.food_name}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="flex items-start justify-between">
                    <span className="rounded-full bg-[#F2F7EF] px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-[#3D5A47]">
                      {item.food_group === 'fruit' && '🍎 Fruit'}
                      {item.food_group === 'vegetable' && '🥦 Vegetable'}
                      {item.food_group === 'protein' && '🍗 Protein'}
                      {item.food_group === 'grain' && '🌾 Grain'}
                      {item.food_group === 'dairy' && '🥛 Dairy'}
                      {item.food_group === 'treat' && '🧁 Treat'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-xl bg-[#EAF7DE] px-2.5 py-1 text-xs font-black text-[#2E6822]">
                        {item.score}/100
                      </span>
                      {!isConfirming && (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(item.id)}
                          title="Delete from Explorer Log"
                          className="grid h-7 w-7 place-items-center rounded-xl bg-[#FDF1EF] text-xs text-[#C04436] transition hover:bg-[#F9DDD8]"
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                  <h3 className="mt-3 text-xl font-black capitalize text-[#173C4A]">
                    {item.food_name}
                  </h3>
                  <p className="mt-2 text-xs font-medium leading-relaxed text-[#5A6E62]">
                    {item.summary}
                  </p>
                </div>

                {isConfirming ? (
                  <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl bg-[#FDF1EF] px-3 py-2 text-xs">
                    <span className="font-black text-[#A63528]">Delete this log?</span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => handleDelete(item.id, item.food_name)}
                        className="rounded-lg bg-[#D64535] px-2.5 py-1 text-[11px] font-black text-white hover:bg-[#b83627] disabled:opacity-50"
                      >
                        {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                      </button>
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => setConfirmDeleteId(null)}
                        className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-black text-[#4F6257] hover:bg-[#F0F4EE]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 pt-3 border-t border-[#F0F4EE] flex items-center justify-between text-[11px]">
                    <span className="font-bold text-[#8C9C90]">
                      {item.created_at ? new Date(item.created_at).toLocaleDateString() : 'Saved'}
                    </span>
                    <button
                      onClick={() => onAskBananini(item.food_name)}
                      className="font-black text-[#287A52] hover:underline"
                    >
                      Ask Bananini →
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Learn({ isAdmin = false }: { isAdmin?: boolean }) {
  const [brainData, setBrainData] = useState<BrainBitesData>({
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
  })
  const [index, setIndex] = useState(0)
  const [answer, setAnswer] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [finished, setFinished] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Admin Management State
  const [manageOpen, setManageOpen] = useState(false)
  const [editingQuestion, setEditingQuestion] = useState<BrainBitesQuestion | null>(null)
  const [isAddingQuestion, setIsAddingQuestion] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Question Form State
  const [qTitle, setQTitle] = useState('')
  const [qOptions, setQOptions] = useState<[string, string, string]>(['', '', ''])
  const [qAnswer, setQAnswer] = useState<number>(0)
  const [qNote, setQNote] = useState('')

  // Extras Form State
  const [challengeTitle, setChallengeTitle] = useState('')
  const [challengeDesc, setChallengeDesc] = useState('')
  const [challengeCta, setChallengeCta] = useState('')
  const [factTitle, setFactTitle] = useState('')
  const [factText, setFactText] = useState('')

  useEffect(() => {
    getBrainBitesDataAction().then((res) => {
      if (res.ok && res.data && res.data.questions?.length) {
        setBrainData(res.data)
        setChallengeTitle(res.data.miniChallenge.title)
        setChallengeDesc(res.data.miniChallenge.description)
        setChallengeCta(res.data.miniChallenge.cta)
        setFactTitle(res.data.didYouKnow.title)
        setFactText(res.data.didYouKnow.fact)
      }
    })
  }, [])

  const openNewQuestionModal = () => {
    setEditingQuestion(null)
    setQTitle('')
    setQOptions(['', '', ''])
    setQAnswer(0)
    setQNote('')
    setIsAddingQuestion(true)
  }

  const openEditQuestionModal = (item: BrainBitesQuestion) => {
    setEditingQuestion(item)
    setQTitle(item.q)
    setQOptions([item.options[0] || '', item.options[1] || '', item.options[2] || ''])
    setQAnswer(item.answer)
    setQNote(item.note)
    setIsAddingQuestion(true)
  }

  const handleSaveQuestion = (e: React.FormEvent) => {
    e.preventDefault()
    if (!qTitle.trim() || !qOptions[0].trim() || !qOptions[1].trim()) {
      alert('Please provide a question and at least 2 answer choices.')
      return
    }

    startTransition(async () => {
      const payload: BrainBitesQuestion = {
        id: editingQuestion?.id || `q_${Date.now()}`,
        q: qTitle.trim(),
        options: qOptions.map((o) => o.trim()).filter(Boolean),
        answer: qAnswer,
        note: qNote.trim(),
      }
      const res = await adminSaveBrainBitesQuestionAction(payload)
      if (res.ok) {
        setBrainData(res.data)
        setIsAddingQuestion(false)
        setFeedback({
          type: 'ok',
          text: `Question ${editingQuestion ? 'updated' : 'added'} successfully!`,
        })
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const handleDeleteQuestion = (questionId: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return
    startTransition(async () => {
      const res = await adminDeleteBrainBitesQuestionAction(questionId)
      if (res.ok) {
        setBrainData(res.data)
        setFeedback({ type: 'ok', text: 'Quiz question deleted.' })
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const handleSaveExtras = (e: React.FormEvent) => {
    e.preventDefault()
    startTransition(async () => {
      const res = await adminUpdateBrainBitesExtrasAction({
        miniChallenge: {
          title: challengeTitle,
          description: challengeDesc,
          cta: challengeCta,
        },
        didYouKnow: {
          title: factTitle,
          fact: factText,
        },
      })
      if (res.ok) {
        setBrainData(res.data)
        setFeedback({ type: 'ok', text: 'Mini challenge & fun fact saved!' })
      } else {
        setFeedback({ type: 'err', text: res.error })
      }
    })
  }

  const activeQuestions = brainData.questions.length > 0 ? brainData.questions : questions
  const q = activeQuestions[index] || activeQuestions[0]

  const choose = (choice: number) => {
    if (answer !== null) return
    setAnswer(choice)
    if (choice === q.answer) setScore((s) => s + 1)
  }

  const next = () => {
    if (index === activeQuestions.length - 1) setFinished(true)
    else {
      setIndex((i) => i + 1)
      setAnswer(null)
    }
  }

  const restart = () => {
    setIndex(0)
    setAnswer(null)
    setScore(0)
    setFinished(false)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Admin Mode Management Bar */}
      {isAdmin && (
        <div className="rounded-[28px] border-2 border-[#173C4A] bg-[#FFFDEB] p-5 shadow-xs">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-[#173C4A] px-3 py-0.5 text-xs font-black uppercase text-white">
                  👑 Admin Mode
                </span>
                <span className="text-xs font-extrabold text-[#5B6B5E]">
                  Bananini&apos;s Brain Bites Manager
                </span>
              </div>
              <p className="mt-1 text-sm font-black text-[#173C4A]">
                Manage quiz questions, answers, and sidebar widgets right inside this page.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setManageOpen(!manageOpen)}
                className={`rounded-2xl px-4 py-2.5 text-xs font-black transition ${
                  manageOpen
                    ? 'bg-[#173C4A] text-white shadow-xs'
                    : 'border border-[#D5E3DB] bg-white text-[#173C4A] hover:bg-[#F2F6F3]'
                }`}
              >
                {manageOpen ? '✕ Close Manager' : '⚙️ Manage Brain Bites'}
              </button>
              <button
                onClick={openNewQuestionModal}
                className="flex items-center gap-1.5 rounded-2xl bg-[#287A52] px-4 py-2.5 text-xs font-black text-white shadow-xs hover:bg-[#1E6240]"
              >
                ➕ Add Question
              </button>
            </div>
          </div>

          {feedback && (
            <div
              className={`mt-4 flex items-center justify-between rounded-xl p-3 text-xs font-bold ${
                feedback.type === 'ok'
                  ? 'bg-[#D9F5D2] text-[#245D1C]'
                  : 'bg-[#F9DDD8] text-[#8C2C20]'
              }`}
            >
              <span>{feedback.text}</span>
              <button onClick={() => setFeedback(null)} className="underline font-black">
                Dismiss
              </button>
            </div>
          )}

          {/* Expandable Brain Bites Admin Manager */}
          {manageOpen && (
            <div className="mt-5 space-y-6 border-t border-[#E8E6CE] pt-5">
              {/* Question List */}
              <div>
                <h4 className="text-xs font-black uppercase tracking-wider text-[#637064]">
                  Active Quiz Questions ({brainData.questions.length})
                </h4>
                <div className="mt-3 space-y-2.5">
                  {brainData.questions.map((item, qIdx) => (
                    <div
                      key={item.id || qIdx}
                      className="flex flex-col justify-between gap-3 rounded-2xl border border-[#DFE8E2] bg-white p-4 sm:flex-row sm:items-center"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-black text-[#173C4A]">
                          <span className="mr-2 text-xs text-[#287A52]">Q{qIdx + 1}.</span>
                          {item.q}
                        </p>
                        <div className="flex flex-wrap gap-2 text-xs font-bold">
                          {item.options.map((opt, optIdx) => (
                            <span
                              key={optIdx}
                              className={`rounded-md px-2 py-0.5 text-[11px] ${
                                optIdx === item.answer
                                  ? 'bg-[#E8F4DF] text-[#1E6939] font-black'
                                  : 'bg-[#F2F5F2] text-[#6B7B70]'
                              }`}
                            >
                              {optIdx === item.answer && '✓ '} {opt}
                            </span>
                          ))}
                        </div>
                        {item.note && (
                          <p className="text-[11px] font-semibold text-[#66786D]">
                            💡 <span className="font-bold">Bananini&apos;s Note:</span> {item.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <button
                          onClick={() => openEditQuestionModal(item)}
                          className="rounded-xl border border-[#D5E3DB] bg-[#F9FBFA] px-3 py-1.5 text-xs font-black text-[#173C4A] hover:bg-[#EEF3F0]"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleDeleteQuestion(item.id)}
                          className="rounded-xl bg-[#FBEAE7] px-3 py-1.5 text-xs font-black text-[#B03E31] hover:bg-[#F6D3CD]"
                        >
                          🗑️ Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sidebar Challenge & Fun Fact Editor */}
              <form
                onSubmit={handleSaveExtras}
                className="rounded-2xl border border-[#E3ECE6] bg-white p-5"
              >
                <div className="flex items-center justify-between border-b border-[#EEF3F0] pb-3">
                  <div>
                    <h4 className="text-sm font-black text-[#173C4A]">
                      Edit Mini Challenge &amp; Did You Know?
                    </h4>
                    <p className="text-xs font-semibold text-[#7D8C81]">
                      Changes will display immediately in the sidebar below.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl bg-[#173C4A] px-4 py-2 text-xs font-black text-white hover:bg-[#255061] disabled:opacity-50"
                  >
                    {isPending ? 'Saving...' : '💾 Save Extras'}
                  </button>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#55695C]">Mini Challenge Title</label>
                    <input
                      type="text"
                      value={challengeTitle}
                      onChange={(e) => setChallengeTitle(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[#D5E3DB] px-3 text-xs font-bold outline-none"
                    />
                    <label className="text-xs font-bold text-[#55695C]">Description</label>
                    <textarea
                      rows={2}
                      value={challengeDesc}
                      onChange={(e) => setChallengeDesc(e.target.value)}
                      className="w-full rounded-xl border border-[#D5E3DB] p-2 text-xs font-semibold outline-none"
                    />
                    <label className="text-xs font-bold text-[#55695C]">Button Text</label>
                    <input
                      type="text"
                      value={challengeCta}
                      onChange={(e) => setChallengeCta(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[#D5E3DB] px-3 text-xs font-bold outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-[#55695C]">Did You Know? Title</label>
                    <input
                      type="text"
                      value={factTitle}
                      onChange={(e) => setFactTitle(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[#D5E3DB] px-3 text-xs font-bold outline-none"
                    />
                    <label className="text-xs font-bold text-[#55695C]">Fun Nutrition Fact</label>
                    <textarea
                      rows={4}
                      value={factText}
                      onChange={(e) => setFactText(e.target.value)}
                      className="w-full rounded-xl border border-[#D5E3DB] p-2 text-xs font-semibold outline-none"
                    />
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Main Quiz & Sidebar View */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.18em] text-[#7A897F]">
            Learn &amp; play
          </p>
          <h1 className="mt-2 text-4xl font-black tracking-[-.04em] sm:text-5xl">
            Bananini&apos;s brain bites
          </h1>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full bg-[#FFF0B5] px-4 py-2 text-sm font-extrabold">
            <Icon name="star" size={16} /> {score * 10} points
          </span>
        </div>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="rounded-[32px] border border-[#E0E5DB] bg-white p-6 sm:p-9">
          {finished ? (
            <div className="py-10 text-center">
              <div className="mx-auto w-fit rounded-full bg-[#E4F1D5] p-2">
                <Bananini small />
              </div>
              <p className="mt-6 text-xs font-extrabold uppercase tracking-widest text-[#708076]">
                Adventure complete
              </p>
              <h2 className="mt-2 text-4xl font-black">
                You got {score} of {activeQuestions.length}!
              </h2>
              <p className="mx-auto mt-3 max-w-md font-semibold text-[#6E7C72]">
                {score === activeQuestions.length
                  ? 'Amazing! Your food-smarts are growing strong.'
                  : 'Nice exploring. Every answer helps your food-smarts grow.'}
              </p>
              <Button onClick={restart} className="mt-7">
                Play again
                <Icon name="arrow" />
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs font-extrabold">
                <span>
                  QUESTION {index + 1} OF {activeQuestions.length}
                </span>
                <span>{Math.round(((index + 1) / activeQuestions.length) * 100)}%</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#EBEFE7]">
                <div
                  className="h-full rounded-full bg-[#E9B833] transition-all"
                  style={{ width: `${((index + 1) / activeQuestions.length) * 100}%` }}
                />
              </div>
              <h2 className="mt-8 text-2xl font-black leading-tight sm:text-3xl">{q.q}</h2>
              <div className="mt-6 space-y-3">
                {q.options.map((option, i) => {
                  const selected = answer === i
                  const correct = answer !== null && i === q.answer
                  return (
                    <button
                      key={option}
                      onClick={() => choose(i)}
                      className={`flex w-full items-center gap-4 rounded-2xl border-2 p-4 text-left font-extrabold transition ${correct ? 'border-[#58A36D] bg-[#E8F4DF]' : selected ? 'border-[#D46F6F] bg-[#FAE5E1]' : 'border-[#E4E8E1] hover:border-[#A5BDAA]'}`}
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-sm">
                        {String.fromCharCode(65 + i)}
                      </span>
                      {option}
                      {correct && (
                        <span className="ml-auto text-[#287A52]">
                          <Icon name="check" />
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              {answer !== null && (
                <div className="mt-6 rounded-2xl bg-[#F3F6EE] p-4">
                  <p className="font-black">
                    {answer === q.answer ? 'Great thinking!' : 'Good try!'}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-[#66736A]">{q.note}</p>
                </div>
              )}
              <div className="mt-6 flex justify-end">
                <Button onClick={next} disabled={answer === null}>
                  {index === activeQuestions.length - 1 ? 'See my score' : 'Next bite'}
                  <Icon name="arrow" />
                </Button>
              </div>
            </>
          )}
        </section>
        <aside className="space-y-4">
          <div className="rounded-[28px] bg-[#FFF0B9] p-6">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white">
              <Icon name="fire" />
            </span>
            <h3 className="mt-5 text-xl font-black">{brainData.miniChallenge.title}</h3>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-[#6E694F]">
              {brainData.miniChallenge.description}
            </p>
            <button className="mt-5 text-sm font-extrabold text-[#7D6120]">
              {brainData.miniChallenge.cta}
            </button>
          </div>
          <div className="rounded-[28px] bg-[#DDEFC8] p-6">
            <p className="text-xs font-extrabold uppercase tracking-widest text-[#68806B]">
              {brainData.didYouKnow.title}
            </p>
            <p className="mt-3 font-black leading-relaxed">
              {brainData.didYouKnow.fact}
            </p>
          </div>
        </aside>
      </div>

      {/* Add / Edit Question Modal */}
      {isAddingQuestion && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-[28px] border border-[#D5E3DB] bg-white p-6 shadow-2xl sm:p-8">
            <h3 className="text-xl font-black text-[#173C4A]">
              {editingQuestion ? 'Edit Brain Bites Question' : 'Add New Brain Bites Question'}
            </h3>
            <p className="mt-1 text-xs font-semibold text-[#6E7E73]">
              Kids will see this question immediately inside Bananini&apos;s brain bites.
            </p>

            <form onSubmit={handleSaveQuestion} className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-extrabold text-[#32453A]">Question Title</label>
                <input
                  required
                  type="text"
                  value={qTitle}
                  onChange={(e) => setQTitle(e.target.value)}
                  placeholder="e.g., Which snack gives you long-lasting energy?"
                  className="mt-1.5 h-11 w-full rounded-xl border border-[#D5E3DB] px-3.5 text-sm font-semibold outline-none focus:border-[#173C4A]"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-[#32453A]">
                  Answer Choices (Pick the radio button for the correct choice)
                </label>
                <div className="mt-2 space-y-2">
                  {([0, 1, 2] as const).map((optIndex) => (
                    <div key={optIndex} className="flex items-center gap-2.5">
                      <input
                        type="radio"
                        name="correctAnswer"
                        checked={qAnswer === optIndex}
                        onChange={() => setQAnswer(optIndex)}
                        className="h-4 w-4 cursor-pointer text-[#173C4A]"
                      />
                      <input
                        required={optIndex < 2}
                        type="text"
                        value={qOptions[optIndex]}
                        onChange={(e) => {
                          const updated = [...qOptions] as [string, string, string]
                          updated[optIndex] = e.target.value
                          setQOptions(updated)
                        }}
                        placeholder={`Option ${String.fromCharCode(65 + optIndex)}${optIndex === qAnswer ? ' (Correct Answer)' : ''}`}
                        className={`h-10 w-full rounded-xl border px-3 text-xs font-bold outline-none ${
                          optIndex === qAnswer
                            ? 'border-[#58A36D] bg-[#E8F4DF]'
                            : 'border-[#D5E3DB] bg-white'
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-extrabold text-[#32453A]">
                  Bananini&apos;s Explanation Note for Kids
                </label>
                <textarea
                  rows={2}
                  value={qNote}
                  onChange={(e) => setQNote(e.target.value)}
                  placeholder="e.g., Fruit plus protein is a power-team for steady energy."
                  className="mt-1.5 w-full rounded-xl border border-[#D5E3DB] p-3 text-xs font-semibold outline-none focus:border-[#173C4A]"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddingQuestion(false)}
                  className="rounded-xl px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="rounded-xl bg-[#173C4A] px-5 py-2 text-xs font-black text-white hover:bg-[#255061]"
                >
                  {isPending ? 'Saving...' : 'Save Question'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function Chat({
  user,
  onSignIn,
  messages,
  setMessages,
  initialPrompt,
  onClearPrefill,
  scannedFood,
  onGoToScan,
}: {
  user: PublicUser | null
  onSignIn: () => void
  messages: { from: 'bot' | 'user'; text: string }[]
  setMessages: React.Dispatch<React.SetStateAction<{ from: 'bot' | 'user'; text: string }[]>>
  initialPrompt?: string
  onClearPrefill?: () => void
  scannedFood?: FoodAnalysis | null
  onGoToScan?: () => void
}) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const handledPromptRef = useRef<string | null>(null)

  useEffect(() => {
    chatScrollRef.current?.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [messages, loading])

  const sendMessageText = async (rawText: string) => {
    if (!user) {
      onSignIn()
      return
    }
    const text = rawText.trim()
    if (!text || loading) return

    const updatedHistory = [...messages, { from: 'user' as const, text }]
    setMessages(updatedHistory)
    setInput('')
    setLoading(true)

    try {
      const res = await askBananiniAction(text, {
        history: updatedHistory,
        scannedFood,
      })
      if (res.ok) {
        setMessages((m) => [...m, { from: 'bot', text: res.data }])
      } else {
        setMessages((m) => [
          ...m,
          { from: 'bot', text: '🍌 Oops! Bananini tripped on a peel. Try asking again!' },
        ])
      }
    } catch {
      setMessages((m) => [
        ...m,
        { from: 'bot', text: '🍌 Bananini is taking a quick nap! Please try again in a moment.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return
    if (!initialPrompt || !initialPrompt.trim()) {
      handledPromptRef.current = null
      return
    }
    const promptText = initialPrompt.trim()
    if (handledPromptRef.current === promptText) return
    handledPromptRef.current = promptText

    onClearPrefill?.()
    setMessages((m) => [...m, { from: 'user', text: promptText }])
    setLoading(true)
    askBananiniAction(promptText, {
      history: [...messages, { from: 'user', text: promptText }],
      scannedFood,
    })
      .then((res) => {
        if (res.ok) {
          setMessages((m) => [...m, { from: 'bot', text: res.data }])
        } else {
          setMessages((m) => [
            ...m,
            { from: 'bot', text: '🍌 Oops! Bananini tripped on a peel. Try asking again!' },
          ])
        }
      })
      .catch(() => {
        setMessages((m) => [
          ...m,
          { from: 'bot', text: '🍌 Bananini is taking a quick nap! Please try again in a moment.' },
        ])
      })
      .finally(() => {
        setLoading(false)
      })
  }, [user, initialPrompt, onClearPrefill, setMessages, scannedFood])

  if (!user) {
    return (
      <div className="mx-auto max-w-xl rounded-[32px] border border-[#E0E5DB] bg-white p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto w-fit rounded-full bg-[#DDEFC8] p-2">
          <Bananini small />
        </div>
        <h1 className="mt-5 text-3xl font-black text-[#173C4A]">Ask Bananini AI</h1>
        <p className="mt-3 font-semibold leading-relaxed text-[#6B7970]">
          Sign in to chat with Bananini, ask nutrition questions about your scanned foods, and get
          personalized healthy snack ideas!
        </p>
        {initialPrompt && (
          <div className="mt-4 rounded-2xl bg-[#F4FAF6] px-4 py-3 text-xs font-bold text-[#287A52]">
            🍌 Your question is ready! Sign in and Bananini will answer it right away.
          </div>
        )}
        <Button onClick={onSignIn} className="mt-7 font-black">
          Sign In to Ask Bananini
        </Button>
      </div>
    )
  }

  const send = async (event: FormEvent) => {
    event.preventDefault()
    await sendMessageText(input)
  }

  const quickPrompts = scannedFood
    ? [
        `Anong benepisyo ng ${scannedFood.name}?`,
        `Healthy partner para sa ${scannedFood.name}?`,
        `Gaano karaming calories meron ito?`,
        'Healthy snack ideas',
        'How do I try veggies?',
      ]
    : [
        'Healthy snack ideas',
        'How do I try veggies?',
        'What gives me energy?',
        'Why is water so good?',
        'Best breakfast before school?',
      ]

  return (
    <div className="mx-auto max-w-4xl">
      <div className="text-center">
        <div className="mx-auto w-fit rounded-full bg-[#DDEFC8] p-1">
          <Bananini small />
        </div>
        <h1 className="mt-4 text-4xl font-black tracking-[-.04em]">Ask Bananini</h1>
        <p className="mt-2 font-semibold text-[#6B7A70]">
          Friendly, AI-powered food answers for curious explorers (English & Tagalog supported!).
        </p>
      </div>
      <section className="mt-7 overflow-hidden rounded-[32px] border border-[#DFE5DB] bg-white shadow-xs">
        <div className="flex items-center justify-between gap-3 border-b border-[#E6EAE3] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-[#57A36E] animate-pulse" />
            <div>
              <p className="text-sm font-black">Bananini Food Guide (Powered by Gemini AI)</p>
              <p className="text-xs font-semibold text-[#839087]">
                {loading ? 'Bananini is thinking...' : 'Ready to help • Remembers your conversation'}
              </p>
            </div>
          </div>
          {messages.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setMessages([
                  {
                    from: 'bot',
                    text: '🍌 Hi! I’m Bananini. Ask me anything about foods, snacks, superpowers, or building a colorful plate!',
                  },
                ])
              }
              className="rounded-full bg-[#F1F5EE] px-3 py-1.5 text-xs font-black text-[#4F6257] transition hover:bg-[#E2EBE0]"
            >
              Clear Chat
            </button>
          )}
        </div>

        {scannedFood && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2F0E5] bg-[#F2FBF4] px-5 py-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-[#1F5C3A]">
              <span className="rounded-full bg-[#287A52] px-2 py-0.5 text-[10px] font-black uppercase text-white">
                Active Scan
              </span>
              <span>
                Bananini sees your <strong>{scannedFood.name}</strong> (
                {scannedFood.estimatedPortion || '1 serving'} • {scannedFood.nutrients.calories}{' '}
                kcal)
              </span>
            </div>
            {onGoToScan && (
              <button
                type="button"
                onClick={onGoToScan}
                className="text-xs font-black text-[#287A52] underline hover:text-[#1C5A3B]"
              >
                View in Scanner →
              </button>
            )}
          </div>
        )}

        <div
          ref={chatScrollRef}
          className="h-[400px] space-y-4 overflow-y-auto bg-[#FAFBF7] p-5 sm:p-7"
          aria-live="polite"
        >
          {messages.map((message, i) => (
            <div
              key={i}
              className={`flex items-end gap-2.5 ${
                message.from === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {message.from === 'bot' && (
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#FFF2B5] text-base shadow-xs">
                  🍌
                </div>
              )}
              <div
                className={`max-w-[80%] rounded-[22px] px-4 py-3 text-sm font-semibold leading-relaxed ${
                  message.from === 'user'
                    ? 'rounded-br-md bg-[#287A52] text-white'
                    : 'rounded-bl-md border border-[#E2E7DF] bg-white text-[#4F6257] shadow-sm'
                }`}
              >
                {message.text.replace(/\*\*/g, '')}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-end gap-2.5 justify-start">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#FFF2B5] text-base shadow-xs">
                🍌
              </div>
              <div className="flex items-center gap-2 rounded-[22px] rounded-bl-md border border-[#E2E7DF] bg-white px-4 py-3 text-sm font-semibold text-[#6B7A70] shadow-sm">
                <span className="inline-block animate-bounce">🍌</span> Bananini is thinking...
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto border-t border-[#E6EAE3] px-4 py-3">
          <span className="shrink-0 text-[11px] font-black uppercase tracking-wider text-[#7D8981]">
            Quick Ask:
          </span>
          {quickPrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              disabled={loading}
              onClick={() => sendMessageText(prompt)}
              className="whitespace-nowrap rounded-full bg-[#EEF4E7] px-3.5 py-2 text-xs font-extrabold text-[#285A35] transition hover:bg-[#deebd2] disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form onSubmit={send} className="flex gap-3 border-t border-[#E6EAE3] p-4">
          <input
            value={input}
            disabled={loading}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Magtanong kay Bananini tungkol sa pagkain o nutrisyon..."
            className="min-w-0 flex-1 rounded-2xl border border-[#D9E1D6] bg-[#FAFBF8] px-4 text-sm font-bold outline-none focus:border-[#62A278] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            aria-label="Send message"
            className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#FFD84D] text-[#3D2A1E] shadow-[0_4px_0_#DBAD23] transition active:translate-y-1 active:shadow-none disabled:opacity-50 disabled:shadow-none"
          >
            <Icon name="send" />
          </button>
        </form>
      </section>
      <p className="mt-4 text-center text-xs font-semibold text-[#7D8981]">
        Bananini gives general food education, not medical advice. Ask a grown-up about allergies or
        health needs.
      </p>
    </div>
  )
}

function Profile({
  user,
  onUpdateUser,
  openAuth,
  onLogout,
  onOpenAdmin,
  onOpenAnalytics,
  onOpenLog,
  onOpenScan,
  onAskBananini,
}: {
  user: PublicUser | null
  onUpdateUser: (updated: PublicUser) => void
  openAuth: () => void
  onLogout: () => void
  onOpenAdmin?: () => void
  onOpenAnalytics?: () => void
  onOpenLog?: () => void
  onOpenScan?: () => void
  onAskBananini?: (foodName: string) => void
}) {
  const [scans, setScans] = useState<FoodLogItem[]>([])
  const [loadingScans, setLoadingScans] = useState(false)

  // Profile Edit State
  const [editingProfile, setEditingProfile] = useState(false)
  const [editName, setEditName] = useState('')
  const [editAgeGroup, setEditAgeGroup] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // Saved Scan Delete State
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setEditName(user.displayName)
      setEditAgeGroup(user.ageGroup)
      setLoadingScans(true)
      getFoodLogsAction().then((res) => {
        if (res.ok) {
          setScans(res.data)
          const accurate = computeAccurateStatsFromLogs(res.data)
          if (user.points !== accurate.points || user.streak !== accurate.streak) {
            onUpdateUser({ ...user, points: accurate.points, streak: accurate.streak })
          }
        }
        setLoadingScans(false)
      })
    }
  }, [user?.id])

  if (!user)
    return (
      <div className="mx-auto max-w-xl rounded-[32px] border border-[#E0E5DB] bg-white p-8 text-center sm:p-12">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#FFF0B9]">
          <Icon name="lock" size={30} />
        </span>
        <h1 className="mt-6 text-3xl font-black">Your explorer space</h1>
        <p className="mt-3 font-semibold text-[#6B7970]">
          Sign in to keep your scans, points, and food adventures together.
        </p>
        <Button onClick={openAuth} className="mt-7">
          Sign in or create account
        </Button>
      </div>
    )

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    setProfileMsg(null)
    try {
      const res = await updateOwnProfileAction({
        displayName: editName,
        ageGroup: editAgeGroup,
      })
      if (res.ok) {
        onUpdateUser(res.data)
        setEditingProfile(false)
        setProfileMsg({ type: 'ok', text: '✅ Profile updated successfully!' })
      } else {
        setProfileMsg({ type: 'err', text: `⚠️ ${res.error}` })
      }
    } finally {
      setSavingProfile(false)
    }
  }

  const handleDeleteSavedScan = async (scanId: string, foodName: string) => {
    setDeletingId(scanId)
    setProfileMsg(null)
    const res = await deleteUserFoodLogAction(scanId)
    if (res.ok) {
      setScans((prev) => prev.filter((item) => item.id !== scanId))
      onUpdateUser({ ...user, points: res.data.points, streak: res.data.streak })
      setConfirmDeleteId(null)
      setProfileMsg({ type: 'ok', text: `🗑️ Removed "${foodName}" from your saved food scans.` })
    } else {
      setProfileMsg({ type: 'err', text: `⚠️ ${res.error}` })
    }
    setDeletingId(null)
  }

  // Compute live accurate stats & achievements directly from saved scans
  const liveStats = computeAccurateStatsFromLogs(scans)
  const displayPoints = loadingScans ? user.points : liveStats.points
  const displayStreak = loadingScans ? user.streak : liveStats.streak

  const distinctGroups = new Set(scans.map((s) => s.food_group)).size
  const hasSuperfood = scans.some((s) => s.score >= 85)
  const badges = [
    {
      id: 'first_scan',
      icon: '🥇',
      title: 'First Discovery',
      desc: 'Save your 1st scanned food',
      unlocked: scans.length >= 1,
    },
    {
      id: 'rainbow',
      icon: '🌈',
      title: 'Rainbow Explorer',
      desc: 'Log 3+ different food groups',
      unlocked: distinctGroups >= 3,
    },
    {
      id: 'superfood',
      icon: '🥗',
      title: 'Superfood Hero',
      desc: 'Log a food with 85+ score',
      unlocked: hasSuperfood,
    },
    {
      id: 'streak',
      icon: '🔥',
      title: 'Streak Star',
      desc: 'Reach a 3+ day streak',
      unlocked: displayStreak >= 3,
    },
  ]

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* User Header */}
      <section className="overflow-hidden rounded-[32px] bg-[#294F3A] p-7 text-white sm:p-10">
        <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-5">
            <span className="grid h-20 w-20 shrink-0 place-items-center rounded-[26px] bg-[#FFD84D] text-[#3D2A1E]">
              <Icon name="user" size={38} />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-bold text-[#B9D2C1]">FOOD EXPLORER</p>
                {user.isAdmin ? (
                  <span className="rounded-full bg-[#FFD84D] px-2.5 py-0.5 text-xs font-black text-[#3D2A1E]">
                    👑 ADMIN
                  </span>
                ) : (
                  <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-black text-white">
                    🌱 LEVEL {user.ageGroup}
                  </span>
                )}
              </div>
              <h1 className="mt-1 text-3xl font-black">{user.displayName}</h1>
              <p className="mt-1 text-sm font-semibold text-white/65">{user.email}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setEditName(user.displayName)
                setEditAgeGroup(user.ageGroup)
                setEditingProfile(!editingProfile)
              }}
              className="rounded-2xl bg-[#FFD84D] px-4 py-3 text-sm font-black text-[#3D2A1E] shadow-xs transition hover:bg-[#ffe170]"
            >
              {editingProfile ? '✕ Cancel Edit' : '✏️ Edit Profile'}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-2xl border border-white/20 px-4 py-3 text-sm font-extrabold hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Inline Edit Profile Form (Works for both Normal User & System Admin!) */}
        {editingProfile && (
          <form
            onSubmit={handleSaveProfile}
            className="mt-6 rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur"
          >
            <h3 className="text-base font-black text-[#FFD84D]">Edit Explorer Profile</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block text-xs font-bold text-white/90">
                Explorer Display Name
                <input
                  type="text"
                  required
                  maxLength={40}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-white/25 bg-white px-3.5 text-sm font-black text-[#173C4A] outline-none"
                />
              </label>
              <label className="block text-xs font-bold text-white/90">
                Learning Level / Age Group
                <select
                  value={editAgeGroup}
                  onChange={(e) => setEditAgeGroup(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-white/25 bg-white px-3.5 text-sm font-black text-[#173C4A] outline-none"
                >
                  <option value="4-6">Ages 4-6 (Little Sprout)</option>
                  <option value="7-9">Ages 7-9 (Junior Explorer)</option>
                  <option value="10-12">Ages 10-12 (Super Captain)</option>
                  {user.isAdmin && <option value="Admin">Admin</option>}
                </select>
              </label>
            </div>
            <p className="mt-3 text-[11px] font-semibold text-white/75">
              ✨ Explorer Points (+15 pts per saved scan) and Daily Streak are automatically
              calculated from your saved food scans.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="rounded-xl border border-white/25 px-4 py-2 text-xs font-bold text-white hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingProfile}
                className="rounded-xl bg-[#FFD84D] px-5 py-2 text-xs font-black text-[#3D2A1E] hover:bg-[#ffe170] disabled:opacity-50"
              >
                {savingProfile ? 'Saving...' : '💾 Save Profile Changes'}
              </button>
            </div>
          </form>
        )}
      </section>

      {profileMsg && (
        <div
          className={`flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black shadow-2xs ${
            profileMsg.type === 'ok'
              ? 'border border-[#CDE8D5] bg-[#EAF8EE] text-[#1E6939]'
              : 'border border-[#F5C6CB] bg-[#FDF1EF] text-[#A63528]'
          }`}
        >
          <span>{profileMsg.text}</span>
          <button onClick={() => setProfileMsg(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Admin Action Card (if user is admin) */}
      {user.isAdmin && (
        <section className="rounded-[30px] border-2 border-[#FFD84D] bg-[#FFFDE6] p-6 shadow-sm sm:p-8">
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-center">
            <div>
              <span className="rounded-full bg-[#FFEC9E] px-2.5 py-0.5 text-xs font-black text-[#3D2A1E]">
                ADMINISTRATOR PRIVILEGES
              </span>
              <h3 className="mt-1 text-xl font-black text-[#173C4A]">
                System Management Feature
              </h3>
              <p className="text-xs font-semibold text-[#666B5E]">
                You have full access to view all explorers, reward/adjust points, and moderate food
                scans.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              {onOpenAnalytics && (
                <button
                  onClick={onOpenAnalytics}
                  className="inline-flex items-center justify-center rounded-2xl border border-[#173C4A]/20 bg-white px-4 py-3 text-xs font-black text-[#173C4A] shadow-2xs transition hover:bg-[#F2F7F9]"
                >
                  📊 Food Analytics →
                </button>
              )}
              {onOpenAdmin && (
                <button
                  onClick={onOpenAdmin}
                  className="inline-flex items-center justify-center rounded-2xl bg-[#173C4A] px-5 py-3 text-sm font-black text-white shadow transition hover:bg-[#255061]"
                >
                  Open System Manager →
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 3 Main Stats Cards */}
      <div className="grid gap-5 sm:grid-cols-3">
        <Stat icon="star" value={String(displayPoints)} label="Explorer points" color="#FFF0B9" />
        <Stat
          icon="fire"
          value={`${displayStreak} ${displayStreak === 1 ? 'day' : 'days'}`}
          label="Current streak"
          color="#F8DBD1"
        />
        <Stat icon="learn" value={user.ageGroup} label="Learning level" color="#DDEFC8" />
      </div>

      {/* Live Explorer Achievements & Badges */}
      <section className="rounded-[30px] border border-[#E0E5DB] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-2xl font-black text-[#173C4A]">Explorer Badges &amp; Achievements</h2>
            <p className="text-xs font-semibold text-[#748077]">
              Unlock badges by scanning healthy foods and building your rainbow plate
            </p>
          </div>
          <span className="rounded-full bg-[#EAF7DE] px-3 py-1 text-xs font-black text-[#287A52]">
            {badges.filter((b) => b.unlocked).length} / {badges.length} Unlocked
          </span>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {badges.map((badge) => (
            <div
              key={badge.id}
              className={`rounded-2xl border p-4 transition ${
                badge.unlocked
                  ? 'border-[#BCE3C8] bg-[#F3FBF5]'
                  : 'border-[#E6EBE4] bg-[#F8FAF7] opacity-60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{badge.icon}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                    badge.unlocked
                      ? 'bg-[#287A52] text-white'
                      : 'bg-[#E2E8E0] text-[#6D7971]'
                  }`}
                >
                  {badge.unlocked ? '✓ Unlocked' : 'Locked'}
                </span>
              </div>
              <p className="mt-2.5 text-sm font-black text-[#173C4A]">{badge.title}</p>
              <p className="mt-1 text-xs font-semibold text-[#66756B]">{badge.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* My Saved Food Scans */}
      <section className="rounded-[30px] border border-[#E0E5DB] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-[#173C4A]">My Saved Food Scans</h2>
            <p className="text-xs font-semibold text-[#7D8C81]">
              {scans.length} {scans.length === 1 ? 'food' : 'foods'} saved to your Explorer Log
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onOpenAnalytics && (
              <button
                type="button"
                onClick={onOpenAnalytics}
                className="rounded-xl border border-[#D5E3DB] bg-[#F8FBF9] px-3.5 py-2 text-xs font-black text-[#173C4A] hover:bg-[#EAF3ED]"
              >
                📊 My Food Analytics
              </button>
            )}
            {onOpenLog && (
              <button
                type="button"
                onClick={onOpenLog}
                className="rounded-xl bg-[#287A52] px-3.5 py-2 text-xs font-black text-white hover:bg-[#1e6040]"
              >
                📖 Full Explorer Log →
              </button>
            )}
          </div>
        </div>
        {loadingScans ? (
          <p className="py-6 text-center text-sm font-bold text-[#7E8D82]">Loading food log...</p>
        ) : scans.length === 0 ? (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-[#F6FAF7] p-5">
            <p className="text-sm font-semibold text-[#5E6E64]">
              No scans saved yet! Head over to the <strong>Scan</strong> tab and click &ldquo;Save to
              My Explorer Log&rdquo; to track your foods here.
            </p>
            {onOpenScan && (
              <Button onClick={onOpenScan}>
                <Icon name="scan" />
                Scan a Food
              </Button>
            )}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {scans.map((s) => {
              const isConfirming = confirmDeleteId === s.id
              const isDeleting = deletingId === s.id
              return (
                <div
                  key={s.id}
                  className="flex flex-col justify-between rounded-2xl border border-[#E8EEE5] bg-[#FBFDFB] p-4 transition hover:border-[#287A52]/30"
                >
                  <div>
                    <div className="flex items-start gap-3">
                      {s.image_url ? (
                        <img
                          src={s.image_url}
                          alt={s.food_name}
                          className="h-16 w-16 shrink-0 rounded-xl border border-[#DCE8DD] object-cover"
                        />
                      ) : (
                        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-[#EAF4EC] text-2xl">
                          🍽️
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="truncate font-black capitalize text-[#173C4A]">
                            {s.food_name}
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <span className="rounded-full bg-[#EAF7DE] px-2.5 py-0.5 text-xs font-black text-[#386D24]">
                              {s.score}/100
                            </span>
                            {!isConfirming && (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(s.id)}
                                title="Delete scan"
                                className="grid h-6 w-6 place-items-center rounded-lg bg-[#FDF1EF] text-[11px] text-[#C04436] hover:bg-[#F9DDD8]"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs font-semibold text-[#7D8C81]">
                          <span className="rounded bg-white px-2 py-0.5 text-[10px] font-black uppercase text-[#287A52] shadow-2xs">
                            {s.food_group}
                          </span>
                          <span>{new Date(s.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-xs font-semibold leading-relaxed text-[#5F7065]">
                      {s.summary}
                    </p>
                  </div>

                  {isConfirming ? (
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-[#FDF1EF] px-3 py-2 text-xs">
                      <span className="font-black text-[#A63528]">Delete this scan?</span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={isDeleting}
                          onClick={() => handleDeleteSavedScan(s.id, s.food_name)}
                          className="rounded-lg bg-[#D64535] px-2.5 py-1 text-[11px] font-black text-white"
                        >
                          {isDeleting ? '...' : 'Yes, Delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-black text-[#4F6257]"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    onAskBananini && (
                      <div className="mt-3 border-t border-[#EDF2EB] pt-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => onAskBananini(s.food_name)}
                          className="text-xs font-black text-[#287A52] hover:underline"
                        >
                          🍌 Ask Bananini →
                        </button>
                      </div>
                    )
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Grown-up safety */}
      <section className="rounded-[30px] border border-[#E0E5DB] bg-white p-6 shadow-sm sm:p-8">
        <h2 className="text-2xl font-black">Grown-up safety</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-[#F3F6EF] p-4">
            <p className="font-black">Private by design</p>
            <p className="mt-1 text-sm font-semibold text-[#6D7971]">
              Food logs belong only to this signed-in account.
            </p>
          </div>
          <div className="rounded-2xl bg-[#F3F6EF] p-4">
            <p className="font-black">Kind guidance</p>
            <p className="mt-1 text-sm font-semibold text-[#6D7971]">
              No calorie counting or body-focused scoring for kids.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}

function Stat({
  icon,
  value,
  label,
  color,
}: {
  icon: IconName
  value: string
  label: string
  color: string
}) {
  return (
    <div className="rounded-[26px] border border-[#E0E5DB] bg-white p-5">
      <span
        className="grid h-11 w-11 place-items-center rounded-2xl"
        style={{ backgroundColor: color }}
      >
        <Icon name={icon} />
      </span>
      <p className="mt-5 text-2xl font-black">{value}</p>
      <p className="mt-1 text-sm font-semibold text-[#748077]">{label}</p>
    </div>
  )
}

function AuthModal({
  mode,
  setMode,
  onClose,
  onSubmit,
  error,
  pending,
}: {
  mode: 'login' | 'signup'
  setMode: (mode: 'login' | 'signup') => void
  onClose: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  error: string
  pending: boolean
}) {
  const [emailValue, setEmailValue] = useState('')
  const [passwordValue, setPasswordValue] = useState('')

  const handleFillAdmin = () => {
    setEmailValue('admin@foodfriends.com')
    setPasswordValue('admin123456')
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[#163425]/55 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div className="relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-[30px] bg-[#FFFDF7] p-6 shadow-2xl sm:p-8">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-5 top-5 grid h-10 w-10 place-items-center rounded-full bg-[#EDF2E9]"
        >
          <Icon name="close" size={19} />
        </button>
        <span className="grid h-14 w-14 place-items-center rounded-[20px] bg-[#FFD84D]">
          <Icon name="user" size={27} />
        </span>
        <h2 id="auth-title" className="mt-5 text-3xl font-black tracking-tight">
          {mode === 'login' ? 'Welcome back!' : 'Start exploring'}
        </h2>
        <p className="mt-2 text-sm font-semibold text-[#6F7B73]">
          {mode === 'login'
            ? 'Your food adventures are waiting.'
            : 'A grown-up email keeps your progress safe.'}
        </p>

        {mode === 'login' && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border-2 border-[#FFD84D] bg-[#FFFCEB] p-3.5 shadow-sm">
            <div>
              <p className="text-xs font-black text-[#173C4A]">👑 System Admin Account</p>
              <p className="text-[11px] font-semibold text-[#666B5E]">admin@foodfriends.com</p>
            </div>
            <button
              type="button"
              onClick={handleFillAdmin}
              className="rounded-xl bg-[#173C4A] px-3 py-1.5 text-xs font-black text-white transition hover:bg-[#255061]"
            >
              Fill Credentials
            </button>
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          {mode === 'signup' && (
            <>
              <label className="block text-sm font-extrabold">
                Explorer name
                <input
                  required
                  name="displayName"
                  maxLength={40}
                  className="mt-2 h-12 w-full rounded-2xl border border-[#D8E0D5] bg-white px-4 outline-none focus:border-[#62A278]"
                  placeholder="Name or nickname"
                />
              </label>
              <label className="block text-sm font-extrabold">
                Age group
                <select
                  name="ageGroup"
                  className="mt-2 h-12 w-full rounded-2xl border border-[#D8E0D5] bg-white px-4 outline-none"
                >
                  <option>4-6</option>
                  <option>7-9</option>
                  <option>10-12</option>
                </select>
              </label>
            </>
          )}
          <label className="block text-sm font-extrabold">
            Grown-up email
            <input
              required
              name="email"
              type="email"
              value={emailValue}
              onChange={(e) => setEmailValue(e.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-[#D8E0D5] bg-white px-4 outline-none focus:border-[#62A278]"
              placeholder="grownup@example.com"
            />
          </label>
          <label className="block text-sm font-extrabold">
            Password
            <input
              required
              minLength={8}
              name="password"
              type="password"
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-[#D8E0D5] bg-white px-4 outline-none focus:border-[#62A278]"
              placeholder="At least 8 characters"
            />
          </label>
          {error && (
            <p
              className="rounded-2xl bg-[#F8E2DD] p-3 text-sm font-bold text-[#8A3E36]"
              role="alert"
            >
              {error}
            </p>
          )}
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'One moment...' : mode === 'login' ? 'Sign in' : 'Create account'}
            <Icon name="arrow" />
          </Button>
        </form>
        <p className="mt-6 text-center text-sm font-semibold text-[#707C74]">
          {mode === 'login' ? 'New to FoodFreinds?' : 'Already an explorer?'}{' '}
          <button
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="font-black text-[#287A52]"
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  )
}
