let rootDir: FileSystemDirectoryHandle | null = null
let recordingsDir: FileSystemDirectoryHandle | null = null

const activeStreams = new Map<string, FileSystemWritableFileStream>()

async function getRecordingsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (recordingsDir) {
    return recordingsDir
  }

  rootDir = await navigator.storage.getDirectory()
  recordingsDir = await rootDir.getDirectoryHandle('recordings', { create: true })
  return recordingsDir
}

function getFileName(id: string): string {
  return `${id}.webm`
}

export async function startRecordingStream(id: string): Promise<void> {
  const dir = await getRecordingsDirectory()
  const fileName = getFileName(id)

  const existingHandle = await dir.getFileHandle(fileName, { create: false }).catch(() => null)
  if (existingHandle) {
    await dir.removeEntry(fileName)
  }

  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  activeStreams.set(id, writable)
}

export async function appendChunk(recordingId: string, chunk: Blob): Promise<void> {
  const stream = activeStreams.get(recordingId)
  if (stream) {
    await stream.write(chunk)
  }
}

export async function finalizeRecording(recordingId: string): Promise<void> {
  const stream = activeStreams.get(recordingId)
  if (stream) {
    await stream.close()
    activeStreams.delete(recordingId)
  }
}

export async function getRecordingBlob(recordingId: string): Promise<Blob | null> {
  const dir = await getRecordingsDirectory()
  const fileName = getFileName(recordingId)

  try {
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    return new Blob([file], { type: 'video/webm' })
  }
  catch {
    return null
  }
}

export async function deleteRecordingBlob(recordingId: string): Promise<void> {
  const dir = await getRecordingsDirectory()
  const fileName = getFileName(recordingId)

  const stream = activeStreams.get(recordingId)
  if (stream) {
    await stream.close()
    activeStreams.delete(recordingId)
  }

  try {
    await dir.removeEntry(fileName)
  }
  catch {
  }
}

export async function getRecordingSize(recordingId: string): Promise<number> {
  const dir = await getRecordingsDirectory()
  const fileName = getFileName(recordingId)

  try {
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    return file.size
  }
  catch {
    return 0
  }
}
