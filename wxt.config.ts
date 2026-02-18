import type { WxtViteConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  vite: (_env) => {
    return {
      plugins: [tailwindcss() as any],
    } satisfies WxtViteConfig
  },
})
