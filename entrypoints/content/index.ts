import { createApp } from 'vue'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import RecordingWidget from './RecordingWidget.vue'
import './style.css'

export default defineContentScript({
  matches: ['<all_urls>'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'safecap-widget',
      position: 'inline',
      anchor: 'body',
      onMount: (container) => {
        const app = createApp(RecordingWidget)
        app.mount(container)
        return app
      },
      onRemove: (app) => {
        app?.unmount()
      },
    })

    ui.mount()
  },
})
