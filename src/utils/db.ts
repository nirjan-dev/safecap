import type { Table } from 'dexie'
import Dexie from 'dexie'

export interface RecordingChunk {
  recordingId: string
  chunkIndex: number
  data: Blob
}

export interface RecordingMetadata {
  id: string
}

export class RecordingDatabase extends Dexie {
  chunks!: Table<RecordingChunk>
  metadata!: Table<RecordingMetadata>

  constructor() {
    super('safecap-recordings')
    this.version(1).stores({
      chunks: '[recordingId+chunkIndex], recordingId',
    })
  }
}

export const recordingDb = new RecordingDatabase()

const chunkCounters = new Map<string, number>()

export async function startRecordingStream(id: string): Promise<void> {
  chunkCounters.set(id, 0)
  await recordingDb.chunks.where({ recordingId: id }).delete()
}

export async function appendChunk(recordingId: string, chunk: Blob): Promise<void> {
  const index = chunkCounters.get(recordingId) || 0
  await recordingDb.chunks.put({
    recordingId,
    chunkIndex: index,
    data: chunk,
  })
  chunkCounters.set(recordingId, index + 1)
}

export async function finalizeRecording(recordingId: string): Promise<void> {
  chunkCounters.delete(recordingId)
}

export async function getRecordingBlob(recordingId: string): Promise<Blob | null> {
  const chunks = await recordingDb.chunks
    .where({ recordingId })
    .sortBy('chunkIndex')

  if (chunks.length === 0) {
    return null
  }

  const blobs = chunks.map(c => c.data)
  return new Blob(blobs, { type: 'video/webm' })
}

export async function deleteRecordingBlob(recordingId: string): Promise<void> {
  await recordingDb.chunks.where({ recordingId }).delete()
}
