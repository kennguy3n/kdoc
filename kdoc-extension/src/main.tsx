import {applyDefaultLayout} from '@kchat/sdk/client'
import {createRoot} from 'react-dom/client'

import {App} from '@/ui/app'
import '@/ui/styles/globals.css'

applyDefaultLayout()

const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error('Root element #root not found')
}

createRoot(rootEl).render(<App />)
