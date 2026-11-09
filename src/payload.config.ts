import path from 'path'
import { buildFigmaConfig } from '@payloadcms/figma'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { en as adminLanguage } from '@payloadcms/translations/languages/en'
import { fileURLToPath } from 'url'
import { Admins } from './collections/Admins'
import { Media } from './collections/Media'
import { Folders } from './collections/Folders'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { FoodLogs } from './collections/FoodLogs'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

// Ensure build succeeds on external hosts (e.g. Vercel) when Figma Make env vars are not present
process.env.FIGMA_EID ||= 'vercel-env'
process.env.FIGMA_CONTENT_API_CONTENT_SYSTEM_ID ||= 'vercel-content-system'
process.env.FIGMA_CONTENT_API_URL ||= 'https://api.figma.com'
process.env.PAYLOAD_SECRET ||= 'foodfriends-default-payload-secret-key-2026'

export default buildFigmaConfig({
  admin: {
    user: Admins.slug,
    constrainWidth: true,
    dashboard: {
      widgets: [],
      defaultLayout: [
        { widgetSlug: 'activity', width: 'full' },
        { widgetSlug: 'collections', width: 'full' },
      ],
    },
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  i18n: {
    fallbackLanguage: 'en',
    supportedLanguages: { en: adminLanguage },
  },
  collections: [Admins, Users, FoodLogs, Media, Folders, Tags],
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  localization: {
    locales: [{ code: 'en', label: 'English' }],
    fallback: true,
    defaultLocale: 'en',
  },
  plugins: [mcpPlugin({})],
  figma: {},
})
