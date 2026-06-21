import type { WxtViteConfig } from 'wxt'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

export default defineConfig({
  modules: ['@wxt-dev/module-vue', '@wxt-dev/auto-icons'],
  manifest: {
    name: 'SafeCap',
    description: 'Private local screen recorder for demos, bug reports, and browser meetings.',
    homepage_url: 'https://safecap.nirjan.net/',
    permissions: ['downloads', 'storage', 'unlimitedStorage', 'sidePanel', 'tabs'],
  },
  vite: (_env) => {
    return {
      plugins: [tailwindcss() as any],
    } satisfies WxtViteConfig
  },
  autoIcons: {
    baseIconPath: './assets/icon.svg',
    developmentIndicator: 'overlay',
  },
  webExt: {
    chromiumArgs: [
      '--user-data-dir=./.wxt/chrome-data',
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
    ],
  },
})
