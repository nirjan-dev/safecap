import { recordingsStorage } from '@/src/utils/storage'

export default defineBackground(() => {
  const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html' as const
  let creatingOffscreen: Promise<void> | null = null

  async function hasOffscreenDocument(): Promise<boolean> {
    const offscreenUrl = browser.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)
    const existingContexts = await browser.runtime.getContexts({
      contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
    })
    return existingContexts.some(ctx => ctx.documentUrl === offscreenUrl)
  }

  async function setupOffscreenDocument(): Promise<void> {
    // Always close existing first to ensure clean state
    await closeOffscreenDocument()

    if (creatingOffscreen) {
      await creatingOffscreen
      return
    }

    creatingOffscreen = browser.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [browser.offscreen.Reason.USER_MEDIA],
      justification: 'Recording screen and audio for demo videos',
    })

    await creatingOffscreen
    creatingOffscreen = null
  }

  async function closeOffscreenDocument(): Promise<void> {
    if (await hasOffscreenDocument()) {
      await browser.offscreen.closeDocument()
    }
  }

  async function saveRecording(recording: { id: string, name: string, createdAt: number, duration: number, blob: string }): Promise<void> {
    const recordings = await recordingsStorage.getValue()
    recordings.push(recording)
    await recordingsStorage.setValue(recordings)
  }

  async function getRecordings(): Promise<any[]> {
    return await recordingsStorage.getValue()
  }

  async function deleteRecording(id: string): Promise<void> {
    const recordings = await recordingsStorage.getValue()
    const filtered = recordings.filter(r => r.id !== id)
    await recordingsStorage.setValue(filtered)
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING':
        setupOffscreenDocument()
          .then(() => browser.runtime.sendMessage(message))
          .then(sendResponse)
          .catch(err => sendResponse({ success: false, error: String(err) }))
        return true

      case 'STOP_RECORDING':
        browser.runtime.sendMessage(message)
          .then(sendResponse)
          .catch(err => sendResponse({ success: false, error: String(err) }))
        return true

      case 'PAUSE_RECORDING':
      case 'RESUME_RECORDING':
      case 'GET_STATE':
        browser.runtime.sendMessage(message)
          .then(sendResponse)
          .catch(err => sendResponse({ success: false, error: String(err) }))
        return true

      case 'SAVE_RECORDING':
        saveRecording(message.recording).then(() => sendResponse({ success: true }))
        return true

      case 'RECORDING_SAVED':
        closeOffscreenDocument()
        return false

      case 'GET_RECORDINGS':
        getRecordings().then(sendResponse)
        return true

      case 'DELETE_RECORDING':
        deleteRecording(message.id).then(() => sendResponse({ success: true }))
        return true

      case 'STATE_UPDATE':
        browser.tabs.query({}).then((tabs) => {
          tabs.forEach((tab) => {
            if (tab.id) {
              browser.tabs.sendMessage(tab.id, message).catch(() => { })
            }
          })
        })
        return false

      case 'CLOSE_OFFSCREEN':
        closeOffscreenDocument()
        return false
    }
    return false
  })
})
