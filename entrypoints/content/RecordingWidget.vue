<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

type RecordingStatus = 'inactive' | 'recording' | 'paused'

const recordingState = ref<RecordingStatus>('inactive')
const duration = ref(0)
let intervalId: number | null = null

function formatDuration(seconds: number): string {
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

const isRecording = computed(() => recordingState.value === 'recording')
const isPaused = computed(() => recordingState.value === 'paused')
const isVisible = computed(() => recordingState.value !== 'inactive')

async function handlePauseResume() {
  if (recordingState.value === 'recording') {
    await browser.runtime.sendMessage({ type: 'PAUSE_RECORDING' })
  }
  else if (recordingState.value === 'paused') {
    await browser.runtime.sendMessage({ type: 'RESUME_RECORDING' })
  }
}

async function handleStop() {
  await browser.runtime.sendMessage({ type: 'STOP_RECORDING' })
}

function startDurationTimer() {
  stopDurationTimer()
  intervalId = window.setInterval(() => {
    duration.value++
  }, 1000)
}

function stopDurationTimer() {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

onMounted(() => {
  browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'STATE_UPDATE') {
      const { recordingState: state, duration: dur } = message.state
      recordingState.value = state
      duration.value = dur

      if (state === 'recording') {
        startDurationTimer()
      }
      else if (state === 'paused') {
        stopDurationTimer()
      }
      else {
        stopDurationTimer()
        duration.value = 0
      }
    }
  })

  browser.runtime.sendMessage({ type: 'GET_STATE' }).then((response) => {
    if (response && response.recordingState !== 'inactive') {
      recordingState.value = response.recordingState
      duration.value = response.duration
      if (response.recordingState === 'recording') {
        startDurationTimer()
      }
    }
  })
})

onUnmounted(() => {
  stopDurationTimer()
})
</script>

<template>
  <div v-if="isVisible" class="safecap-widget">
    <div
      class="status-indicator"
      :class="{ recording: isRecording, paused: isPaused }"
    />

    <span class="duration">{{ formatDuration(duration) }}</span>

    <button
      class="control-btn pause-btn"
      @click="handlePauseResume"
    >
      <svg v-if="isRecording" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16" rx="1" />
        <rect x="14" y="4" width="4" height="16" rx="1" />
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5,3 19,12 5,21" />
      </svg>
    </button>

    <button
      class="control-btn stop-btn"
      @click="handleStop"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <rect x="4" y="4" width="16" height="16" rx="2" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
.safecap-widget {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: #1a1a2e;
  border-radius: 12px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
  z-index: 2147483647;
  font-family:
    system-ui,
    -apple-system,
    sans-serif;
  border: 1px solid #2a2a4a;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #ef4444;
}

.status-indicator.recording {
  animation: safecap-pulse 1.5s ease-in-out infinite;
}

.status-indicator.paused {
  animation: none;
  background: #f59e0b;
}

.duration {
  color: #ffffff;
  font-size: 14px;
  font-weight: 500;
  min-width: 60px;
  font-variant-numeric: tabular-nums;
}

.control-btn {
  background: transparent;
  border: none;
  color: #a0a0b0;
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.control-btn:hover {
  background: #2a2a4a;
}

.stop-btn {
  background: #ef4444;
  color: white;
}

.stop-btn:hover {
  background: #dc2626;
}

@keyframes safecap-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}
</style>
