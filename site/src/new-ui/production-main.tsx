import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/inter/latin-600.css'
import '@fontsource/inter/latin-700.css'
import '@fontsource/tajawal/arabic-400.css'
import '@fontsource/tajawal/arabic-500.css'
import '@fontsource/tajawal/arabic-700.css'
import '@fontsource/tajawal/arabic-800.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import { AdapterProvider } from './adapters/AdapterProvider'
import { productionAdapters } from './adapters/productionAdapters'
import { ExperienceProvider } from './app/ExperienceProvider'
import { ProductionApp, ProductionRouteError } from './app/ProductionApp'
import { prepareProductionEntry } from './app/productionRouter'
import './foundation/tokens.css'
import './foundation/global.css'
import './foundation/components.css'
import './foundation/checkbox.css'
import './foundation/layouts.css'
import './foundation/public.css'
import './foundation/auth.css'
import './foundation/portal.css'
import './foundation/admin.css'
import './foundation/admin-login.css'
import './foundation/admin-responsive.css'
import './foundation/support-workspace.css'

prepareProductionEntry()
const router = createBrowserRouter([
  { path: '*', Component: ProductionApp, ErrorBoundary: ProductionRouteError },
])
if (import.meta.hot) import.meta.hot.dispose(() => router.dispose())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExperienceProvider>
      <AdapterProvider adapters={productionAdapters}>
        <RouterProvider router={router} />
      </AdapterProvider>
    </ExperienceProvider>
  </StrictMode>,
)
