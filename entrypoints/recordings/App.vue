<script lang="ts" setup>
import type { Recording as StorageRecording } from '@/src/utils/storage'
import { Icon } from '@iconify/vue'
import { onMounted, ref } from 'vue'
import { recordingsStorage } from '@/src/utils/storage'

type Recording = Omit<StorageRecording, 'blob'> & { blob: Blob }

const recordings = ref<Recording[]>([])
const selectedRecording = ref<Recording | null>(null)
const videoUrl = ref<string | null>(null)
const dialogRef = ref<HTMLDialogElement | null>(null)
const loading = ref(true)

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatFileSize(bytes: number): string {
  if (bytes === 0)
    return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 0)
    return `${days} day${days > 1 ? 's' : ''} ago`
  if (hours > 0)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  if (minutes > 0)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  return 'Just now'
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
  loading.value = true
  const rawRecordings = await recordingsStorage.getValue()
  recordings.value = rawRecordings
    .map(r => ({
      ...r,
      blob: base64ToBlob(r.blob, 'video/webm'),
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
  loading.value = false
}

function playRecording(recording: Recording) {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
  }
  videoUrl.value = URL.createObjectURL(recording.blob)
  selectedRecording.value = recording
  setTimeout(() => {
    dialogRef.value?.showModal()
  }, 0)
}

function closePlayer() {
  if (videoUrl.value) {
    URL.revokeObjectURL(videoUrl.value)
    videoUrl.value = null
  }
  selectedRecording.value = null
  dialogRef.value?.close()
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
  <div class="min-h-screen bg-base-200 p-6">
    <div class="max-w-5xl mx-auto">
      <div class="flex items-center justify-between mb-8">
        <h1 class="text-3xl font-bold">
          My Recordings
        </h1>
        <div v-if="loading" class="badge badge-lg badge-neutral">
          <span class="loading loading-spinner loading-xs mr-1" />
          Loading...
        </div>
        <div v-else class="badge badge-lg badge-neutral">
          {{ recordings.length }} recording{{ recordings.length !== 1 ? 's' : '' }}
        </div>
      </div>

      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div v-for="i in 4" :key="i" class="card bg-base-100 shadow-sm">
          <div class="card-body p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <div class="skeleton h-5 w-3/4 mb-2" />
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                  <div class="skeleton h-4 w-16" />
                  <div class="skeleton h-4 w-16" />
                  <div class="skeleton h-4 w-20" />
                </div>
                <div class="skeleton h-3 w-1/2 mt-2" />
              </div>
              <div class="flex flex-col gap-2">
                <div class="skeleton h-8 w-16" />
                <div class="flex gap-1">
                  <div class="skeleton h-8 w-8" />
                  <div class="skeleton h-8 w-8" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="recordings.length === 0" class="text-center py-20">
        <div class="inline-flex items-center justify-center w-20 h-20 rounded-full bg-base-300 mb-4">
          <Icon icon="lucide:video" class="w-10 h-10 text-base-content/40" />
        </div>
        <p class="text-lg text-base-content/70">
          No recordings yet
        </p>
        <p class="text-sm text-base-content/50 mt-2 max-w-sm mx-auto">
          Click "Record Demo" in the extension popup to create your first recording.
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          v-for="recording in recordings"
          :key="recording.id"
          class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow"
        >
          <div class="card-body p-5">
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <h2 class="card-title text-base truncate" :title="recording.name">
                  {{ recording.name }}
                </h2>
                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-sm text-base-content/60">
                  <span class="flex items-center gap-1">
                    <Icon icon="lucide:clock" class="w-4 h-4" />
                    {{ formatDuration(recording.duration) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon icon="lucide:hard-drive" class="w-4 h-4" />
                    {{ formatFileSize(recording.size) }}
                  </span>
                  <span class="flex items-center gap-1">
                    <Icon icon="lucide:history" class="w-4 h-4" />
                    {{ formatRelativeTime(recording.createdAt) }}
                  </span>
                </div>
                <div v-if="recording.tabUrl" class="mt-2 text-xs text-base-content/40 truncate max-w-full" :title="recording.tabUrl">
                  {{ recording.tabUrl }}
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <button
                  class="btn btn-primary btn-sm"
                  @click="playRecording(recording)"
                >
                  <Icon icon="lucide:play" class="w-4 h-4" />
                  Play
                </button>
                <div class="flex gap-1">
                  <button
                    class="btn btn-secondary btn-sm flex-1"
                    title="Download"
                    @click="downloadRecording(recording)"
                  >
                    <Icon icon="lucide:download" class="w-4 h-4" />
                  </button>
                  <button
                    class="btn btn-error btn-sm flex-1 btn-outline"
                    title="Delete"
                    @click="deleteRecording(recording.id)"
                  >
                    <Icon icon="lucide:trash-2" class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <dialog ref="dialogRef" class="modal" @close="closePlayer">
      <div v-if="selectedRecording && videoUrl" class="modal-box w-11/12 max-w-5xl flex flex-col max-h-[90vh]">
        <div class="flex justify-between items-center pb-3 border-b border-base-300">
          <div class="min-w-0 pr-4">
            <h2 class="text-lg font-semibold truncate">
              {{ selectedRecording.name }}
            </h2>
            <p class="text-sm text-base-content/60">
              {{ formatDuration(selectedRecording.duration) }} • {{ formatFileSize(selectedRecording.size) }}
            </p>
          </div>
          <form method="dialog">
            <button class="btn btn-sm btn-circle btn-ghost flex-shrink-0">
              <Icon icon="lucide:x" class="w-5 h-5" />
            </button>
          </form>
        </div>
        <div class="flex-1 overflow-hidden mt-3">
          <video
            :src="videoUrl"
            controls
            class="w-full h-full max-h-[70vh] rounded-lg object-contain bg-black"
            autoplay
          />
        </div>
      </div>
      <form method="dialog" class="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  </div>
</template>
