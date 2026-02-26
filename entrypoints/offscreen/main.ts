interface Recording {
  id: string
  blob: Blob
  name: string
  createdAt: number
  duration: number
}

type RecordingStatus = 'inactive' | 'recording' | 'paused'

let mediaRecorder: MediaRecorder | null = null
let chunks: Blob[] = []
let recordingStartTime = 0
let pausedDuration = 0
let currentRecordingId = ''

const state = {
  recordingState: 'inactive' as RecordingStatus,
  duration: 0,
}

function generateId(): string {
  return `rec_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

async function startRecording(): Promise<{ success: boolean, error?: string }> {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface: 'browser',
      },
      audio: {},
      systemAudio: 'include',
    } as any)

    stream.getVideoTracks()[0].onended = () => {
      stopRecording()
    }

    currentRecordingId = generateId()
    chunks = []
    recordingStartTime = Date.now()
    pausedDuration = 0

    mediaRecorder = new MediaRecorder(stream, {
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

      const recording: Recording = {
        id: currentRecordingId,
        blob,
        name: `Recording ${new Date(recordingStartTime).toLocaleString()}`,
        createdAt: recordingStartTime,
        duration,
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
  const base64 = await blobToBase64(recording.blob)

  await browser.runtime.sendMessage({
    type: 'SAVE_RECORDING',
    recording: {
      id: recording.id,
      name: recording.name,
      createdAt: recording.createdAt,
      duration: recording.duration,
      blob: base64,
    },
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
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
