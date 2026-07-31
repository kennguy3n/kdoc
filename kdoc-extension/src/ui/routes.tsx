import type {ReactElement} from 'react'

import {EditorPage} from '@/ui/pages/editor'
import {HomePage} from '@/ui/pages/home'
import {NotFoundPage} from '@/ui/pages/not-found'

export interface RouteDef {
  path: string
  element: ReactElement
}

export const routes: RouteDef[] = [
  {
    path: '/',
    element: <HomePage />,
  },
  {
    path: '/home',
    element: <HomePage />,
  },
  {
    path: '/editor',
    element: <EditorPage />,
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]
