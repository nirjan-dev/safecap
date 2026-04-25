import type { RecordingMetadata } from '@/src/utils/storage'
import { deleteRecording as deleteRecordingFromStorage, recordingsStorage, saveRecordingMetadata } from '@/src/utils/storage'

export default defineBackground(() => {
  if (browser.sidePanel) {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  }

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
      case 'SAVE_RECORDING':
        saveRecordingMetadata(message.recording).then(() => {
          sendResponse({ success: true })
        }).catch((err) => {
          sendResponse({ success: false, error: String(err) })
        })
        return true

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
