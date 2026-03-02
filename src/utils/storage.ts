import { storage } from '#imports'

export interface Recording {
  id: string
  name: string
  createdAt: number
  duration: number
  size: number
  tabTitle?: string
  tabUrl?: string
  blob: string
}

export type RecordingMetadata = Omit<Recording, 'blob'>

export const recordingsStorage = storage.defineItem<RecordingMetadata[]>('local:recordings', {
  fallback: [],
  version: 2,
})

const recordingBlobsStorage = storage.defineItem<Record<string, string>>('local:recording_blobs', {
  fallback: {},
  version: 1,
})

export async function getRecordingBlob(id: string): Promise<string | null> {
  const blobs = await recordingBlobsStorage.getValue()
  return blobs[id] || null
}

export async function saveRecordingBlob(id: string, blob: string): Promise<void> {
  const blobs = await recordingBlobsStorage.getValue()
  blobs[id] = blob
  await recordingBlobsStorage.setValue(blobs)
}

export async function deleteRecordingBlob(id: string): Promise<void> {
  const blobs = await recordingBlobsStorage.getValue()
  delete blobs[id]
  await recordingBlobsStorage.setValue(blobs)
}

export async function getRecording(id: string): Promise<Recording | null> {
  const recordings = await recordingsStorage.getValue()
  const metadata = recordings.find(r => r.id === id) || null

  if (!metadata) {
    return null
  }

  const blob = await getRecordingBlob(id)
  return { ...metadata, blob: blob || '' }
}

export async function saveRecording(recording: Recording): Promise<void> {
  const metadata: RecordingMetadata = {
    id: recording.id,
    name: recording.name,
    createdAt: recording.createdAt,
    duration: recording.duration,
    size: recording.size,
    tabTitle: recording.tabTitle,
    tabUrl: recording.tabUrl,
  }

  const recordings = await recordingsStorage.getValue()
  const existing = recordings.findIndex(r => r.id === recording.id)

  if (existing >= 0) {
    recordings[existing] = metadata
  }
  else {
    recordings.push(metadata)
  }

  await recordingsStorage.setValue(recordings)
  await saveRecordingBlob(recording.id, recording.blob)
}

export async function deleteRecording(id: string): Promise<void> {
  const recordings = await recordingsStorage.getValue()
  const filtered = recordings.filter(r => r.id !== id)
  await recordingsStorage.setValue(filtered)
  await deleteRecordingBlob(id)
}

// TODO: may want to get rid of this when going to prod because there won't be v1 videos to migrate
export async function migrateRecordingsToSeparateBlobs(): Promise<void> {
  const oldRecordingsStorage = storage.defineItem<Recording[]>('local:recordings', {
    fallback: [],
    version: 1,
  })
  const rawRecordings = await oldRecordingsStorage.getValue()

  if (!rawRecordings || rawRecordings.length === 0) {
    return
  }

  const hasBlobs = rawRecordings.some((r: Recording) => r.blob && r.blob.length > 0)
  if (!hasBlobs) {
    return
  }

  const hasAlreadyMigrated = rawRecordings.every((r: Recording) => !r.blob || r.blob === '')
  if (hasAlreadyMigrated) {
    return
  }

  const blobs: Record<string, string> = {}
  const metadata: RecordingMetadata[] = []

  for (const r of rawRecordings) {
    blobs[r.id] = r.blob
    metadata.push({
      id: r.id,
      name: r.name,
      createdAt: r.createdAt,
      duration: r.duration,
      size: r.size,
      tabTitle: r.tabTitle,
      tabUrl: r.tabUrl,
    })
  }

  await recordingBlobsStorage.setValue(blobs)
  await recordingsStorage.setValue(metadata)
}
