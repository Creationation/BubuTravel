import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PlacesProvider } from './context/PlacesContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import MapPage from './pages/MapPage'

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading && !session) return <Splash />
  if (!session) return <Navigate to="/login" replace />
  return <PlacesProvider>{children}</PlacesProvider>
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="chip">Chargement...</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <Protected>
                <Dashboard />
              </Protected>
            }
          />
          <Route
            path="/carte"
            element={
              <Protected>
                <MapPage />
              </Protected>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
