import * as db from './db'
import * as opfs from './opfs'

export type StorageBackend = 'opfs' | 'indexeddb'

export const currentBackend: StorageBackend = 'opfs'

const functions = currentBackend === 'opfs' ? opfs : db

export const startRecordingStream = functions.startRecordingStream
export const appendChunk = functions.appendChunk
export const finalizeRecording = functions.finalizeRecording
export const getRecordingBlob = functions.getRecordingBlob
export const deleteRecordingBlob = functions.deleteRecordingBlob

export function getBackendName(): string {
  return currentBackend === 'opfs' ? 'OPFS' : 'IndexedDB'
}
