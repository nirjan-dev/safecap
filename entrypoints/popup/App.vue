<script lang="ts" setup>
import { Icon } from '@iconify/vue'

type RecordingStatus = 'inactive' | 'recording' | 'paused' | 'processing'

const recordingState = ref<RecordingStatus>('inactive')
const isStarting = ref(false)
const micEnabled = ref(false)
const transcriptTabId = ref<number | null>(null)

async function checkMicPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    micEnabled.value = status.state === 'granted'
    status.onchange = () => {
      micEnabled.value = status.state === 'granted'
    }
  }
  catch {
  }
}

async function enableMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
    micEnabled.value = true
  }
  catch {
    await browser.tabs.create({
      url: browser.runtime.getURL('/micsetup.html' as any),
    })
  }
}

async function startRecording() {
  if (recordingState.value !== 'inactive')
    return

  if (!micEnabled.value) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach(t => t.stop())
      micEnabled.value = true
    }
    catch {
    }
  }

  isStarting.value = true
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const tabInfo = tab?.title && tab?.url
      ? { title: tab.title, url: tab.url }
      : undefined

    const response = await browser.runtime.sendMessage({
      type: 'START_RECORDING',
      tabInfo,
    })
    if (!response.success) {
      console.error('Failed to start recording:', response.error)
    }
  }
  finally {
    isStarting.value = false
  }
}

function openRecordings() {
  browser.tabs.create({ url: browser.runtime.getURL('/recordings.html' as any) })
}

async function stopRecording() {
  await browser.runtime.sendMessage({ type: 'STOP_RECORDING' })
  recordingState.value = 'inactive'
}

async function checkTranscriptTab() {
  const tabs = await browser.tabs.query({})
  const transcriptTab = tabs.find(tab => tab.url?.includes('transcript.html'))
  if (transcriptTab) {
    transcriptTabId.value = transcriptTab.id ?? null
  }
  else {
    transcriptTabId.value = null
    recordingState.value = 'inactive'
  }
}

async function loadStateFromStorage() {
  try {
    const result = await browser.storage.local.get(['recordingState', 'recordingId']) as { recordingState?: RecordingStatus, recordingId?: string }
    if (result.recordingState && result.recordingState !== 'inactive') {
      recordingState.value = result.recordingState
    }
  }
  catch {
  }
}

onMounted(async () => {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      if (message.state) {
        recordingState.value = message.state.recordingState || 'inactive'
      }
    }
    else if (message.type === 'RECORDING_STOPPED') {
      recordingState.value = 'inactive'
      transcriptTabId.value = null
    }
  })

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.recordingState) {
      recordingState.value = changes.recordingState.newValue as RecordingStatus
    }
  })

  await checkTranscriptTab()
  await loadStateFromStorage()
  await checkMicPermission()

  setInterval(checkTranscriptTab, 2000)
})
</script>

<template>
  <div class="w-64 p-4 bg-base-300">
    <h1 class="text-2xl font-bold mb-4 text-center">
      SafeCap
    </h1>

    <div class="flex flex-col gap-2">
      <button
        v-if="recordingState === 'inactive' || isStarting"
        class="btn btn-primary"
        :disabled="isStarting"
        @click="startRecording"
      >
        <span v-if="isStarting" class="loading loading-spinner loading-sm" />
        <span v-else>Record Demo</span>
      </button>

      <button
        v-else-if="recordingState === 'recording' || recordingState === 'paused'"
        class="btn btn-error"
        @click="stopRecording"
      >
        <Icon icon="lucide:square" class="w-4 h-4" />
        Stop Recording
      </button>

      <button
        class="btn btn-outline"
        :class="micEnabled ? 'btn-success' : ''"
        @click="enableMicrophone"
      >
        {{ micEnabled ? 'Mic On' : 'Enable Mic' }}
      </button>

      <button
        class="btn btn-secondary"
        @click="openRecordings"
      >
        My Recordings
      </button>
    </div>

    <div v-if="transcriptTabId && recordingState !== 'inactive'" class="mt-4 text-center">
      <span class="badge badge-error gap-2">
        <span class="w-2 h-2 bg-white rounded-full animate-pulse" />
        Recording in progress
      </span>
    </div>
  </div>
</template>
