import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { OpenAPI } from './api/generated'
import { App } from './App'
import './styles.css'

OpenAPI.BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8080/api'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
