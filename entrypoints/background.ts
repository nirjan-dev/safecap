import type { Recording } from '@/src/utils/storage'
import { storage } from '@wxt-dev/storage'

interface StreamingSession {
  chunks: Uint8Array[]
  metadata: Omit<Recording, 'blob'>
}

export default defineBackground(() => {
  // NOTE: Storage items MUST be defined inside the callback, not imported from external modules.
  // WXT's build-time permission scanner only detects storage usage within defineBackground's callback body.
  // See: https://github.com/wxt-dev/wxt/issues/371
  const recordingsStorage = storage.defineItem<Recording[]>('local:recordings', {
    fallback: [],
    version: 1,
  })

  const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html' as const
  let creatingOffscreen: Promise<void> | null = null

  const activeStreams = new Map<string, StreamingSession>()

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  }

  function base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

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

  async function saveRecording(recording: Recording): Promise<void> {
    const recordings = await recordingsStorage.getValue()
    recordings.push(recording)
    await recordingsStorage.setValue(recordings)
  }

  async function getRecordings(): Promise<Recording[]> {
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

      case 'STREAM_START': {
        const { id, metadata } = message as { id: string, metadata: Omit<Recording, 'blob'> }

        activeStreams.set(id, {
          chunks: [],
          metadata,
        })

        return false
      }

      case 'STREAM_CHUNK': {
        const { id, chunk } = message as { id: string, chunk: string }
        const stream = activeStreams.get(id)

        if (stream) {
          const bytes = base64ToUint8Array(chunk)
          stream.chunks.push(bytes)
        }

        return false
      }

      case 'STREAM_END': {
        const { id } = message as { id: string }
        const stream = activeStreams.get(id)

        if (!stream) {
          return false
        }

        const blob = new Blob(stream.chunks as BlobPart[], { type: 'video/webm' })
        blobToBase64(blob).then((base64) => {
          const recording: Recording = { ...stream.metadata, blob: base64 }
          saveRecording(recording).then(() => {
            activeStreams.delete(id)
            closeOffscreenDocument()
          })
        })

        return false
      }

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
