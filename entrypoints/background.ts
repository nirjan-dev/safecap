import type { RecordingMetadata } from '@/src/utils/storage'
import { deleteRecording as deleteRecordingFromStorage, recordingsStorage, saveRecordingMetadata } from '@/src/utils/storage'

interface TabInfo {
  title?: string
  url?: string
}

export default defineBackground(() => {
  const recordingsStorageLocal = recordingsStorage

  async function getRecordings(): Promise<RecordingMetadata[]> {
    const recordings = await recordingsStorageLocal.getValue()
    return recordings as RecordingMetadata[]
  }

  async function deleteRecording(id: string): Promise<void> {
    await deleteRecordingFromStorage(id)
  }

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.type) {
      case 'START_RECORDING': {
        const tabInfo: TabInfo | undefined = message.tabInfo
        browser.tabs.create({
          url: browser.runtime.getURL('/transcript.html' as any),
        }).then((tab) => {
          if (tab.id) {
            browser.tabs.sendMessage(tab.id, {
              type: 'INIT_WITH_TAB_INFO',
              tabInfo,
            }).catch(() => { })
          }
          sendResponse({ success: true })
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) })
        })
        return true
      }

      case 'STOP_RECORDING':
      case 'PAUSE_RECORDING':
      case 'RESUME_RECORDING':
        browser.tabs.query({}).then((tabs) => {
          tabs.forEach((tab) => {
            if (tab.id && tab.url?.includes('transcript.html')) {
              browser.tabs.sendMessage(tab.id, message).catch(() => { })
            }
          })
        })
        sendResponse({ success: true })
        return true

      case 'SAVE_RECORDING_WITH_TRANSCRIPT':
        saveRecordingMetadata(message.recording).then(() => {
          sendResponse({ success: true })
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) })
        })
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

      case 'GET_RECORDINGS':
        getRecordings().then(sendResponse)
        return true

      case 'DELETE_RECORDING':
        deleteRecording(message.id).then(() => sendResponse({ success: true }))
        return true
    }
    return false
  })
})
