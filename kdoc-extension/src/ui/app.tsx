import {HashRouter, Route, Routes} from 'react-router-dom'

import {ExtensionClientProvider} from '@/runtime'
import {ExtensionErrorBoundary} from '@/ui/components/primitives/error-boundary'
import {routes} from '@/ui/routes'

export function App() {
  return (
    <ExtensionErrorBoundary>
      <ExtensionClientProvider>
        <HashRouter>
          <Routes>
            {routes.map((route) => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))}
          </Routes>
        </HashRouter>
      </ExtensionClientProvider>
    </ExtensionErrorBoundary>
  )
}
