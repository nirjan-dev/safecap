<script lang="ts" setup>
type RecordingStatus = 'inactive' | 'recording' | 'paused'

const recordingState = ref<RecordingStatus>('inactive')
const isStarting = ref(false)

async function startRecording() {
  if (recordingState.value !== 'inactive')
    return

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
    if (response.success) {
      recordingState.value = 'recording'
    }
    else {
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

async function checkState() {
  const response = await browser.runtime.sendMessage({ type: 'GET_STATE' })
  if (response) {
    recordingState.value = response.recordingState
  }
}

onMounted(async () => {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      recordingState.value = message.state.recordingState
    }
  })
  await checkState()
})
</script>

<template>
  <div class="w-64 p-4 bg-base-300">
    <h1 class="text-2xl font-bold mb-4 text-center">
      SafeCap
    </h1>

    <div class="flex flex-col gap-2">
      <button
        class="btn btn-primary"
        :disabled="recordingState !== 'inactive' || isStarting"
        @click="startRecording"
      >
        <span v-if="isStarting" class="loading loading-spinner loading-sm" />
        <span v-else-if="recordingState === 'inactive'">Record Demo</span>
        <span v-else>Recording...</span>
      </button>

      <button
        class="btn btn-secondary"
        @click="openRecordings"
      >
        My Recordings
      </button>
    </div>

    <div v-if="recordingState !== 'inactive'" class="mt-4 text-center">
      <span class="badge badge-error gap-2">
        <span class="w-2 h-2 bg-white rounded-full animate-pulse" />
        Recording in progress
      </span>
    </div>
  </div>
</template>
