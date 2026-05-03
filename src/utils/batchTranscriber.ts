export interface TranscriptSegment {
  text: string
  start: number
  end: number
}

export interface TranscriptionResult {
  segments: TranscriptSegment[]
  fullText: string
  duration: number
}

const CHUNK_DURATION_MS = 5 * 60 * 1000
const WORDS_PER_MINUTE = 150

interface SpeechRecognitionInstance {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  start: (track?: MediaStreamTrack) => void
  stop: () => void
}

function getSpeechRecognitionConstructor(): (new () => SpeechRecognitionInstance) | null {
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

export async function transcribeRecording(
  audioBlob: Blob,
  onProgress?: (progress: number, stage: string) => void,
): Promise<TranscriptionResult> {
  const SpeechRecognition = getSpeechRecognitionConstructor()
  if (!SpeechRecognition) {
    console.warn('Speech Recognition not supported')
    return { segments: [], fullText: '', duration: 0 }
  }

  onProgress?.(0, 'preparing')

  try {
    const arrayBuffer = await audioBlob.arrayBuffer()
    const audioContext = new AudioContext()
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
    const durationSec = audioBuffer.duration
    const durationMs = durationSec * 1000

    const estimatedWords = Math.ceil((durationSec / 60) * WORDS_PER_MINUTE)
    onProgress?.(10, `Analyzing audio: ~${estimatedWords} words`)

    const chunks: { blob: Blob, start: number, duration: number }[] = []
    const chunkDuration = Math.min(CHUNK_DURATION_MS, 60000)
    for (let start = 0; start < durationMs; start += chunkDuration) {
      const chunkDur = Math.min(chunkDuration, durationMs - start)
      const startSample = Math.floor((start / 1000) * audioBuffer.sampleRate)
      const durationSamples = Math.floor((chunkDur / 1000) * audioBuffer.sampleRate)

      const endSample = Math.min(startSample + durationSamples, audioBuffer.length)
      if (startSample >= endSample)
        continue

      const chunkData = audioBuffer.getChannelData(0).slice(startSample, endSample)
      const chunkBlob = new Blob([chunkData], { type: 'audio/webm' })
      chunks.push({ blob: chunkBlob, start, duration: chunkDur })
    }

    const allSegments: TranscriptSegment[] = []
    let lastEndTime = 0
    const totalChunks = chunks.length

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const progress = 20 + Math.round(((i + 1) / totalChunks) * 70)
      onProgress?.(progress, `Transcribing ${i + 1}/${totalChunks}`)

      const result = await transcribeChunk(chunk.blob, chunk.start, SpeechRecognition)

      for (const seg of result.segments) {
        if (seg.text.trim() && seg.text.length > 2) {
          const adjustedStart = seg.start
          const adjustedEnd = seg.end

          if (allSegments.length > 0 && Math.abs(allSegments[allSegments.length - 1].end - adjustedStart) < 1) {
            allSegments[allSegments.length - 1].text += ` ${seg.text}`
            allSegments[allSegments.length - 1].end = adjustedEnd
          }
          else {
            allSegments.push({
              text: seg.text,
              start: lastEndTime,
              end: adjustedEnd,
            })
          }
          lastEndTime = adjustedEnd
        }
      }
    }

    onProgress?.(95, 'finalizing')

    const mergedSegments = mergeAdjacentSegments(allSegments)

    onProgress?.(100, 'complete')

    return {
      segments: mergedSegments,
      fullText: mergedSegments.map(s => s.text).join(' '),
      duration: durationSec,
    }
  }
  catch (e) {
    console.error('Transcription failed:', e)
    onProgress?.(0, 'Transcription failed')
    return { segments: [], fullText: '', duration: 0 }
  }
}

async function transcribeChunk(
  audioBlob: Blob,
  startTimeMs: number,
  SpeechRecognitionCtor: new () => SpeechRecognitionInstance,
): Promise<TranscriptionResult> {
  return new Promise((resolve) => {
    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = true
    recognition.interimResults = false
    recognition.lang = 'en-US'

    const segments: TranscriptSegment[] = []
    let segmentStart = startTimeMs / 1000
    let accumulatedText = ''

    recognition.onresult = (event: any) => {
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const text = result[0].transcript.trim()
          if (text) {
            accumulatedText += (accumulatedText ? ' ' : '') + text
            const endTime = startTimeMs / 1000 + i * 30
            segments.push({
              text: accumulatedText,
              start: segmentStart,
              end: endTime,
            })
            accumulatedText = ''
            segmentStart = endTime
          }
        }
      }
    }

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error)
    }

    recognition.onend = () => {
      resolve({
        segments,
        fullText: segments.map(s => s.text).join(' '),
        duration: startTimeMs / 1000,
      })
    }

    const audioElement = new Audio()
    audioElement.src = URL.createObjectURL(audioBlob)

    audioElement.oncanplay = () => {
      try {
        const stream = (audioElement as any).captureStream?.() || (audioElement as any).mozCaptureStream?.()
        if (stream) {
          const audioTrack = stream.getAudioTracks()[0]
          if (audioTrack) {
            audioElement.play()
            setTimeout(() => {
              recognition.start(audioTrack)
            }, 100)
            return
          }
        }
      }
      catch (e) {
        console.warn('Could not capture audio stream:', e)
      }
      resolve({ segments: [], fullText: '', duration: startTimeMs / 1000 })
    }

    audioElement.onerror = () => {
      console.warn('Audio load error')
      resolve({ segments: [], fullText: '', duration: startTimeMs / 1000 })
    }

    audioElement.load()
  })
}

function mergeAdjacentSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  if (segments.length <= 1)
    return segments

  const merged: TranscriptSegment[] = []
  let current = { ...segments[0] }

  for (let i = 1; i < segments.length; i++) {
    const next = segments[i]
    const timeGap = next.start - current.end

    if (timeGap <= 2 && current.text && next.text) {
      current.text += ` ${next.text}`
      current.end = next.end
    }
    else {
      merged.push(current)
      current = { ...next }
    }
  }

  merged.push(current)
  return merged
}

export function formatTranscriptAsText(segments: TranscriptSegment[]): string {
  return segments.map((seg) => {
    const mins = Math.floor(seg.start / 60)
    const secs = Math.floor(seg.start % 60)
    return `[${mins}:${secs.toString().padStart(2, '0')}] ${seg.text}`
  }).join('\n')
}
