<script lang="ts" setup>
import type { Recording as StorageRecording } from '@/src/utils/storage'
import { onMounted, ref } from 'vue'
import { recordingsStorage } from '@/src/utils/storage'

type Recording = Omit<StorageRecording, 'blob'> & { blob: Blob }

const recordings = ref<Recording[]>([])
const selectedRecording = ref<Recording | null>(null)
const videoUrl = ref<string | null>(null)

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString()
}

function base64ToBlob(base64: string, type: string): Blob {
  const byteString = atob(base64.split(',')[1])
  const arrayBuffer = new ArrayBuffer(byteString.length)
  const uint8Array = new Uint8Array(arrayBuffer)
  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i)
  }
  return new Blob([uint8Array], { type })
}

async function loadRecordings() {
  const rawRecordings = await recordingsStorage.getValue()
  recordings.value = rawRecordings.map(r => ({
    ...r,
    blob: base64ToBlob(r.blob, 'video/webm'),
  }))
}

function playRecording(recording: Recording) {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }
  videoUrl.value = URL.createObjectURL(recording.blob)
  selectedRecording.value = recording
}

function closePlayer() {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
    videoUrl.value = null
  }
  selectedRecording.value = null
}

async function downloadRecording(recording: Recording) {
  const url = URL.createObjectURL(recording.blob)
  const filename = `${recording.name.replace(/[^a-z0-9]/gi, '_')}.webm`

  await browser.downloads.download({
    url,
    filename,
    saveAs: true,
  })
}

async function deleteRecording(id: string) {
  const current = await recordingsStorage.getValue()
  await recordingsStorage.setValue(current.filter(r => r.id !== id))
  await loadRecordings()

  if (selectedRecording.value?.id === id) {
    closePlayer()
  }
}

onMounted(() => {
  loadRecordings()
})
</script>

<template>
  <div class="min-h-screen bg-base-200 p-8">
    <div class="max-w-4xl mx-auto">
      <h1 class="text-3xl font-bold mb-8">
        My Recordings
      </h1>

      <div v-if="recordings.length === 0" class="text-center py-16 text-base-content/60">
        <p class="text-lg">
          No recordings yet
        </p>
        <p class="text-sm mt-2">
          Click "Record Demo" in the extension popup to create your first recording.
        </p>
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="recording in recordings"
          :key="recording.id"
          class="card bg-base-100 shadow-md"
        >
          <div class="card-body">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="card-title">
                  {{ recording.name }}
                </h2>
                <p class="text-sm text-base-content/60">
                  {{ formatDate(recording.createdAt) }} &bull; {{ formatDuration(recording.duration) }}
                </p>
              </div>
              <div class="flex gap-2">
                <button
                  class="btn btn-primary btn-sm"
                  @click="playRecording(recording)"
                >
                  Play
                </button>
                <button
                  class="btn btn-secondary btn-sm"
                  @click="downloadRecording(recording)"
                >
                  Download
                </button>
                <button
                  class="btn btn-error btn-sm btn-outline"
                  @click="deleteRecording(recording.id)"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="selectedRecording && videoUrl"
      class="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      @click.self="closePlayer"
    >
      <div class="bg-base-100 rounded-lg p-4 max-w-4xl w-full mx-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold">
            {{ selectedRecording.name }}
          </h2>
          <button
            class="btn btn-sm btn-circle btn-ghost"
            @click="closePlayer"
          >
            ✕
          </button>
        </div>
        <video
          :src="videoUrl"
          controls
          class="w-full rounded-lg"
          autoplay
        />
      </div>
    </div>
  </div>
</template>
