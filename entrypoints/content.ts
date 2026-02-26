export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    type RecordingStatus = 'inactive' | 'recording' | 'paused'

    let widgetContainer: HTMLDivElement | null = null
    let currentState: RecordingStatus = 'inactive'

    function formatDuration(seconds: number): string {
      const hrs = Math.floor(seconds / 3600)
      const mins = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60

      if (hrs > 0) {
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
      }
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }

    function createWidget(): HTMLDivElement {
      const container = document.createElement('div')
      container.id = 'safecap-widget'
      container.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #1a1a2e;
        border-radius: 12px;
        padding: 12px 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        z-index: 2147483647;
        font-family: system-ui, -apple-system, sans-serif;
        border: 1px solid #2a2a4a;
      `

      const statusIndicator = document.createElement('div')
      statusIndicator.id = 'safecap-status'
      statusIndicator.style.cssText = `
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #ef4444;
        animation: safecap-pulse 1.5s ease-in-out infinite;
      `

      const durationDisplay = document.createElement('span')
      durationDisplay.id = 'safecap-duration'
      durationDisplay.textContent = formatDuration(0)
      durationDisplay.style.cssText = `
        color: #ffffff;
        font-size: 14px;
        font-weight: 500;
        min-width: 60px;
        font-variant-numeric: tabular-nums;
      `

      const pauseBtn = document.createElement('button')
      pauseBtn.id = 'safecap-pause'
      pauseBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="4" width="4" height="16" rx="1"/>
          <rect x="14" y="4" width="4" height="16" rx="1"/>
        </svg>
      `
      pauseBtn.style.cssText = `
        background: transparent;
        border: none;
        color: #a0a0b0;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      `
      pauseBtn.onmouseenter = () => pauseBtn.style.background = '#2a2a4a'
      pauseBtn.onmouseleave = () => pauseBtn.style.background = 'transparent'
      pauseBtn.onclick = handlePauseResume

      const stopBtn = document.createElement('button')
      stopBtn.id = 'safecap-stop'
      stopBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
        </svg>
      `
      stopBtn.style.cssText = `
        background: #ef4444;
        border: none;
        color: white;
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
      `
      stopBtn.onmouseenter = () => stopBtn.style.background = '#dc2626'
      stopBtn.onmouseleave = () => stopBtn.style.background = '#ef4444'
      stopBtn.onclick = handleStop

      container.appendChild(statusIndicator)
      container.appendChild(durationDisplay)
      container.appendChild(pauseBtn)
      container.appendChild(stopBtn)

      const style = document.createElement('style')
      style.textContent = `
        @keyframes safecap-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `
      document.head.appendChild(style)

      return container
    }

    function showWidget() {
      if (!widgetContainer) {
        widgetContainer = createWidget()
        document.body.appendChild(widgetContainer)
      }
      widgetContainer.style.display = 'flex'
    }

    function hideWidget() {
      if (widgetContainer) {
        widgetContainer.style.display = 'none'
      }
    }

    function updateWidget(status: RecordingStatus, duration: number) {
      if (!widgetContainer)
        return

      const statusIndicator = widgetContainer.querySelector('#safecap-status') as HTMLDivElement
      const durationDisplay = widgetContainer.querySelector('#safecap-duration') as HTMLSpanElement
      const pauseBtn = widgetContainer.querySelector('#safecap-pause') as HTMLButtonElement

      durationDisplay.textContent = formatDuration(duration)

      if (status === 'recording') {
        statusIndicator.style.background = '#ef4444'
        statusIndicator.style.animation = 'safecap-pulse 1.5s ease-in-out infinite'
        pauseBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="4" width="4" height="16" rx="1"/>
            <rect x="14" y="4" width="4" height="16" rx="1"/>
          </svg>
        `
      }
      else if (status === 'paused') {
        statusIndicator.style.background = '#f59e0b'
        statusIndicator.style.animation = 'none'
        pauseBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21"/>
          </svg>
        `
      }
    }

    async function handlePauseResume() {
      if (currentState === 'recording') {
        await browser.runtime.sendMessage({ type: 'PAUSE_RECORDING' })
      }
      else if (currentState === 'paused') {
        await browser.runtime.sendMessage({ type: 'RESUME_RECORDING' })
      }
    }

    async function handleStop() {
      await browser.runtime.sendMessage({ type: 'STOP_RECORDING' })
      hideWidget()
    }

    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'STATE_UPDATE') {
        const { recordingState, duration } = message.state
        currentState = recordingState

        if (recordingState === 'inactive') {
          hideWidget()
        }
        else {
          showWidget()
          updateWidget(recordingState, duration)
        }
      }
    })

    browser.runtime.sendMessage({ type: 'GET_STATE' }).then((response) => {
      if (response && response.recordingState !== 'inactive') {
        currentState = response.recordingState
        showWidget()
        updateWidget(response.recordingState, response.duration)
      }
    })
  },
})
