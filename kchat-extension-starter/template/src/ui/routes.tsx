/**
 * Route definitions for the extension.
 *
 * Each route mirrors `manifest.json#contributes.paths[].path`:
 *   /home → home-page
 *
 * Add routes here as you add paths to the manifest.
 */

import {type ReactElement} from 'react'
import {Navigate, Route, Routes} from 'react-router-dom'

import {NotFound} from '@/ui/pages/not-found'
import {HomePage} from '@/ui/pages/home'

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/home" replace />} />
      <Route path="/home" element={<HomePage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
