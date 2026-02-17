import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth'
import { EntitlementProvider } from './entitlements'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <EntitlementProvider>
        <App />
      </EntitlementProvider>
    </AuthProvider>
  </StrictMode>,
)
