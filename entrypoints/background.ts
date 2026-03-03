import type { RecordingMetadata } from '@/src/utils/storage'
import { appendChunk, finalizeRecording, startRecordingStream } from '@/src/utils/db'
import { deleteRecording as deleteRecordingFromStorage, recordingsStorage, saveRecordingMetadata } from '@/src/utils/storage'

interface StreamingSession {
  metadata: RecordingMetadata
}

export default defineBackground(() => {
  const recordingsStorageLocal = recordingsStorage

  const OFFSCREEN_DOCUMENT_PATH = '/offscreen.html' as const
  let creatingOffscreen: Promise<void> | null = null

  const activeStreams = new Map<string, StreamingSession>()

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

  async function getRecordings(): Promise<RecordingMetadata[]> {
    const recordings = await recordingsStorageLocal.getValue()
    return recordings as RecordingMetadata[]
  }

  async function deleteRecording(id: string): Promise<void> {
    await deleteRecordingFromStorage(id)
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
        const { id, metadata } = message as { id: string, metadata: RecordingMetadata }

        startRecordingStream(id).catch((err) => {
          console.error('Failed to start recording stream:', err)
        })

        activeStreams.set(id, {
          metadata,
        })

        return false
      }

      case 'STREAM_CHUNK': {
        const { id, chunk } = message as { id: string, chunk: string }
        const stream = activeStreams.get(id)

        if (stream) {
          const bytes = base64ToUint8Array(chunk)
          const blobChunk = new Blob([bytes.slice().buffer], { type: 'video/webm' })
          appendChunk(id, blobChunk).catch((err) => {
            console.error('Failed to save chunk to IndexedDB:', err)
          })
        }

        return false
      }

      case 'STREAM_END': {
        const { id } = message as { id: string }
        const stream = activeStreams.get(id)

        if (!stream) {
          return false
        }

        finalizeRecording(id).then(() => {
          const recording: RecordingMetadata = {
            id: stream.metadata.id,
            name: stream.metadata.name,
            createdAt: stream.metadata.createdAt,
            duration: stream.metadata.duration,
            size: stream.metadata.size,
            tabTitle: stream.metadata.tabTitle,
            tabUrl: stream.metadata.tabUrl,
          }

          return saveRecordingMetadata(recording)
        }).then(() => {
          activeStreams.delete(id)
          closeOffscreenDocument()
        }).catch((err) => {
          console.error('Failed to save recording:', err)
        })

        return false
      }

      case 'SAVE_RECORDING':
        saveRecordingMetadata(message.recording).then(() => sendResponse({ success: true }))
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
