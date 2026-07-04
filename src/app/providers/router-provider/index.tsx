import { BrowserRouter } from 'react-router-dom'

import { AppRoutes } from '@/app/router/routes'

export function RouterProvider() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
