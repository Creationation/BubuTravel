import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PlacesProvider } from './context/PlacesContext'
import { ThemeProvider } from './context/ThemeContext'
import { I18nProvider } from './i18n/I18nContext'
import { TrackerProvider } from './context/TrackerContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import MapPage from './pages/MapPage'
import TripsPage from './pages/TripsPage'
import TripView from './pages/TripView'
import GalleryPage from './pages/GalleryPage'
import BucketlistPage from './pages/BucketlistPage'
import EventsPage from './pages/EventsPage'
import PlannerPage from './pages/PlannerPage'
import ProfilePage from './pages/ProfilePage'
import SharePage from './pages/SharePage'
import PasswordPage from './pages/PasswordPage'
import UpdatePrompt from './components/UpdatePrompt'
import { useT } from './i18n/I18nContext'

function Protected({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading && !session) return <Splash />
  if (!session) return <Navigate to="/login" replace />
  return (
    <PlacesProvider>
      <TrackerProvider>{children}</TrackerProvider>
    </PlacesProvider>
  )
}

function Splash() {
  const t = useT()
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-[13px] text-text-muted">{t('common.loading')}</p>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          {/* Sous AuthProvider : la langue est lue dans le profil du compte */}
          <I18nProvider>
            {/* L'invite de mise a jour traduit, elle doit vivre sous I18nProvider */}
            <UpdatePrompt />
            <Routes>
            <Route path="/login" element={<Login />} />
            {/* Page publique, sans compte ni session */}
            <Route path="/p/:token" element={<SharePage />} />
            {/* Arrivee du lien de reinitialisation, hors zone protegee */}
            <Route path="/motdepasse" element={<PasswordPage />} />

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
            <Route
              path="/voyages"
              element={
                <Protected>
                  <TripsPage />
                </Protected>
              }
            />
            <Route
              path="/voyages/:id"
              element={
                <Protected>
                  <TripView />
                </Protected>
              }
            />
            <Route
              path="/bucketlist"
              element={
                <Protected>
                  <BucketlistPage />
                </Protected>
              }
            />
            <Route
              path="/planificateur"
              element={
                <Protected>
                  <PlannerPage />
                </Protected>
              }
            />
            <Route
              path="/evenements"
              element={
                <Protected>
                  <EventsPage />
                </Protected>
              }
            />
            <Route
              path="/galerie"
              element={
                <Protected>
                  <GalleryPage />
                </Protected>
              }
            />
            <Route
              path="/profil"
              element={
                <Protected>
                  <ProfilePage />
                </Protected>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </I18nProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
