/**
 * Extension UI root.
 *
 * The host webview loads `dist/index.html` with a hash route
 * resolved from the manifest. HashRouter is used because the entry
 * is a static asset; this keeps in-extension navigation server-less
 * and lets the host update the route by changing the iframe hash
 * without remounting the runtime.
 *
 * Tree order: ErrorBoundary (outermost) → ExtensionClientProvider
 * (bridge handshake) → HashRouter → AppRoutes.
 */

import {memo, type ReactElement} from 'react'
import {HashRouter} from 'react-router-dom'

import {ExtensionClientProvider} from '@/runtime'
import {ExtensionErrorBoundary} from '@/ui/components/primitives'

import {AppRoutes} from './routes'

export const App = memo(function App(): ReactElement {
  return (
    <ExtensionErrorBoundary>
      <ExtensionClientProvider>
        <HashRouter>
          <div className="flex h-full min-h-0 w-full flex-col bg-background text-foreground @container">
            <AppRoutes />
          </div>
        </HashRouter>
      </ExtensionClientProvider>
    </ExtensionErrorBoundary>
  )
})

App.displayName = 'App'
