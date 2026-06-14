import type { RecordingMetadata } from '@/src/utils/storage'
import { deleteRecording as deleteRecordingFromStorage, recordingsStorage, saveRecordingMetadata } from '@/src/utils/storage'

interface ActiveTabInfo {
  id?: number
  title?: string
  url?: string
  windowId?: number
}

export default defineBackground(() => {
  if (browser.sidePanel) {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  }

  const recordingsStorageLocal = recordingsStorage

  function isExtensionUrl(url?: string): boolean {
    return Boolean(url?.startsWith(browser.runtime.getURL('')))
  }

  function getTabInfo(tab?: ActiveTabInfo): ActiveTabInfo | null {
    if (!tab || isExtensionUrl(tab.url)) {
      return null
    }

    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
    }
  }

  async function getActiveTabInfo(): Promise<ActiveTabInfo | null> {
    const [lastFocusedTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
    const lastFocusedInfo = getTabInfo(lastFocusedTab)
    if (lastFocusedInfo) {
      return lastFocusedInfo
    }

    const [currentWindowTab] = await browser.tabs.query({ active: true, currentWindow: true })
    return getTabInfo(currentWindowTab)
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

      case 'GET_ACTIVE_TAB_INFO':
        getActiveTabInfo().then(sendResponse).catch((err) => {
          console.warn('Failed to get active tab info:', err)
          sendResponse(null)
        })
        return true
    }
    return false
  })
})
