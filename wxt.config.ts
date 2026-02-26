import type { WxtViteConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  manifest: {
    permissions: ['activeTab', 'downloads', 'storage', 'offscreen', 'unlimitedStorage'],
  },
  debug: true,
  webExt: {
    chromiumPort: 9229,
  },
  vite: (_env) => {
    return {
      plugins: [tailwindcss() as any],
    } satisfies WxtViteConfig
  },
})
