export interface TranscriptSegment {
  text: string
  start: number
  end: number
}

export interface Chapter {
  title: string
  start: number
  end: number
  summary?: string
}

export interface RecordingTranscript {
  recordingId: string
  generatedAt: number
  segments: TranscriptSegment[]
  summary: string
  chapters: Chapter[]
}

let rootDir: FileSystemDirectoryHandle | null = null
let transcriptsDir: FileSystemDirectoryHandle | null = null

async function getTranscriptsDirectory(): Promise<FileSystemDirectoryHandle> {
  if (transcriptsDir) {
    return transcriptsDir
  }

  rootDir = await navigator.storage.getDirectory()
  transcriptsDir = await rootDir.getDirectoryHandle('transcripts', { create: true })
  return transcriptsDir
}

function getFileName(id: string): string {
  return `${id}.transcript.json`
}

export async function saveTranscript(recordingId: string, transcript: RecordingTranscript): Promise<void> {
  const dir = await getTranscriptsDirectory()
  const fileName = getFileName(recordingId)

  const existingHandle = await dir.getFileHandle(fileName, { create: false }).catch(() => null)
  if (existingHandle) {
    await dir.removeEntry(fileName)
  }

  const fileHandle = await dir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(transcript, null, 2))
  await writable.close()
}

export async function getTranscript(recordingId: string): Promise<RecordingTranscript | null> {
  const dir = await getTranscriptsDirectory()
  const fileName = getFileName(recordingId)

  try {
    const fileHandle = await dir.getFileHandle(fileName)
    const file = await fileHandle.getFile()
    const text = await file.text()
    return JSON.parse(text) as RecordingTranscript
  }
  catch {
    return null
  }
}

export async function deleteTranscript(recordingId: string): Promise<void> {
  const dir = await getTranscriptsDirectory()
  const fileName = getFileName(recordingId)

  try {
    await dir.removeEntry(fileName)
  }
  catch {
  }
}

export async function hasTranscriptFile(recordingId: string): Promise<boolean> {
  const dir = await getTranscriptsDirectory()
  const fileName = getFileName(recordingId)

  try {
    await dir.getFileHandle(fileName)
    return true
  }
  catch {
    return false
  }
}
