import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'BuBuTravel, carnet de voyage',
        short_name: 'BuBuTravel',
        description:
          'Les pays et lieux visites, les photos, les parcours et les envies, sur une carte.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#1d1422',
        theme_color: '#2a1630',
        categories: ['travel', 'lifestyle'],
        // « Partager vers BuBuTravel » depuis TikTok, Instagram, YouTube ou
        // Maps (Android, app installee) : le lien arrive sur /idees et part
        // directement a l'analyse.
        share_target: {
          action: '/idees',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Coller un lien', url: '/idees' },
          { name: 'Ouvrir la carte', url: '/carte' },
          { name: 'Mes envies', url: '/bucketlist' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            // Tuiles de carte : l'app reste lisible hors ligne sur les zones
            // deja consultees, ce qui compte en voyage.
            // Nouveau nom de cache : l'ancien « tuiles-carto » contient les
            // images « API KEY REQUIRED » et ne doit plus etre relu.
            urlPattern: /^https:\/\/tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tuiles-osm',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'polices',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Les URL signees expirent au bout d'une heure : les mettre en
            // cache afficherait des liens morts. NetworkOnly explicite.
            urlPattern: /\/storage\/v1\/object\/sign\//i,
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
})
