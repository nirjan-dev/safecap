interface Recording {
  id: string
  blob: Blob
  name: string
  createdAt: number
  duration: number
  size: number
  tabTitle?: string
  tabUrl?: string
}

type RecordingStatus = 'inactive' | 'recording' | 'paused'

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let recordingStartTime = 0
let pausedDuration = 0
let currentRecordingId = ''
let currentTabInfo: { title?: string, url?: string } | undefined

const state = {
  recordingState: 'inactive' as RecordingStatus,
  duration: 0,
}

function generateId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function generateRecordingName(tabTitle?: string): string {
  if (tabTitle) {
    return tabTitle
  }
  return `Recording ${new Date(recordingStartTime).toLocaleString()}`
}

async function maybeGetMicStream(): Promise<MediaStream | null> {
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    return mic
  }
  catch (e) {
    console.log('mic getUserMedia failed (continuing without mic):', e)
    return null
  }
}

function mixAudio(tabStream: MediaStream, micStream: MediaStream | null): MediaStream {
  const tabAudio = tabStream.getAudioTracks()[0]
  if (!micStream || !tabAudio)
    return tabStream

  const ctx = new AudioContext()
  const dst = ctx.createMediaStreamDestination()

  const tabSource = ctx.createMediaStreamSource(new MediaStream([tabAudio]))
  tabSource.connect(ctx.destination)
  tabSource.connect(dst)

  const micTrack = micStream.getAudioTracks()[0]
  if (micTrack) {
    ctx.createMediaStreamSource(new MediaStream([micTrack])).connect(dst)
  }

  return new MediaStream([
    ...tabStream.getVideoTracks(),
    ...dst.stream.getAudioTracks(),
  ])
}

async function startRecording(): Promise<{ success: boolean, error?: string }> {
  try {
    const tabStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
      },
      audio: {},
      systemAudio: 'include',
    } as any)

    tabStream.getVideoTracks()[0].onended = () => {
      stopRecording()
    }

    const micStream = await maybeGetMicStream()
    const mixedStream = mixAudio(tabStream, micStream)

    currentRecordingId = generateId()
    chunks = []
    recordingStartTime = Date.now()
    pausedDuration = 0

    mediaRecorder = new MediaRecorder(mixedStream, {
      mimeType: 'video/webm;codecs=vp9',
    })

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data)
      }
    }

    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const duration = (Date.now() - recordingStartTime - pausedDuration) / 1000

      const name = generateRecordingName(currentTabInfo?.title)

      const recording: Recording = {
        id: currentRecordingId,
        blob,
        name,
        createdAt: recordingStartTime,
        duration,
        size: blob.size,
        tabTitle: currentTabInfo?.title,
        tabUrl: currentTabInfo?.url,
      }

      await sendRecordingToBackground(recording)
      broadcastState()

      // Signal that saving is complete
      await browser.runtime.sendMessage({ type: 'RECORDING_SAVED' })
    }

    mediaRecorder.start(1000)
    state.recordingState = 'recording'
    state.duration = 0
    broadcastState()
    startDurationTimer()

    return { success: true }
  }
  catch (error) {
    console.error('Failed to start recording:', error)
    return { success: false, error: String(error) }
  }
}

function stopRecording(): { success: boolean } {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop()
    mediaRecorder.stream.getTracks().forEach(track => track.stop())
    mediaRecorder = null
    state.recordingState = 'inactive'
    state.duration = 0
    broadcastState()
    stopDurationTimer()
  }
  return { success: true }
}

function pauseRecording(): { success: boolean } {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.pause()
    state.recordingState = 'paused'
    pausedDuration -= Date.now()
    broadcastState()
  }
  return { success: true }
}

function resumeRecording(): { success: boolean } {
  if (mediaRecorder && mediaRecorder.state === 'paused') {
    mediaRecorder.resume()
    state.recordingState = 'recording'
    pausedDuration += Date.now()
    broadcastState()
  }
  return { success: true }
}

function getState(): typeof state {
  return { ...state }
}

async function sendRecordingToBackground(recording: Recording): Promise<void> {
  const metadata = {
    id: recording.id,
    name: recording.name,
    createdAt: recording.createdAt,
    duration: recording.duration,
    size: recording.size,
    tabTitle: recording.tabTitle,
    tabUrl: recording.tabUrl,
  }

  await browser.runtime.sendMessage({
    type: 'STREAM_START',
    id: recording.id,
    metadata,
  })

  const stream = recording.blob.stream()
  const reader = stream.getReader()

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    const base64 = uint8ArrayToBase64(value)

    await browser.runtime.sendMessage({
      type: 'STREAM_CHUNK',
      id: recording.id,
      chunk: base64,
    })
  }

  await browser.runtime.sendMessage({
    type: 'STREAM_END',
    id: recording.id,
  })
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

let durationTimer: number | null = null

function startDurationTimer() {
  durationTimer = window.setInterval(() => {
    if (state.recordingState === 'recording') {
      state.duration = Math.floor((Date.now() - recordingStartTime - pausedDuration) / 1000)
      broadcastState()
    }
  }, 1000)
}

function stopDurationTimer() {
  if (durationTimer) {
    clearInterval(durationTimer)
    durationTimer = null
  }
}

function broadcastState() {
  browser.runtime.sendMessage({
    type: 'STATE_UPDATE',
    state: getState(),
  }).catch(() => { })
}

browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'START_RECORDING':
      currentTabInfo = message.tabInfo
      startRecording().then(sendResponse)
      return true
    case 'STOP_RECORDING':
      sendResponse(stopRecording())
      return false
    case 'PAUSE_RECORDING':
      sendResponse(pauseRecording())
      return false
    case 'RESUME_RECORDING':
      sendResponse(resumeRecording())
      return false
    case 'GET_STATE':
      sendResponse(getState())
      return false
  }
})

console.log('Offscreen document ready')
