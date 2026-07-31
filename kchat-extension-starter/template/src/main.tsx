import '@/ui/styles/globals.css'

import {applyDefaultLayout} from '@kchat/sdk/client'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import {App} from '@/ui/app'

// Stretch html / body / #root so the extension fills the host-sized
// `<webview>`. The host never injects CSS into the guest document;
// this opt-in helper is the SDK's contract for filling. Theme
// (color-scheme, body background) is applied later inside the React
// tree via `ExtensionClientProvider` so it can react to live
// `kchat:themechange` events.
applyDefaultLayout()

const container = document.getElementById('root')
if (!container) {
  throw new Error('Failed to find #root element to mount the extension UI')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
