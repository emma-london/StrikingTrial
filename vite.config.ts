import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Deployed to GitHub Pages at https://emma-london.github.io/StrikingTrial/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // autoUpdate: the new service worker installs in the background whenever
      // the user is online and takes over on the next launch — no reload prompt,
      // and it can never disrupt an offline session because it needs the network
      // to update. This preserves the ~2-minute Vite deploy pipeline: push, and
      // users pick up the new version the next time they open the app online.
      registerType: 'autoUpdate',
      // Inject the registration script into index.html for us; no code change
      // needed in main.tsx.
      injectRegister: 'auto',
      // The plugin now owns the manifest (previously public/manifest.webmanifest).
      manifest: {
        name: 'Striking Trial',
        short_name: 'Striking',
        description: 'Record and analyse tower bell striking.',
        id: '/StrikingTrial/',
        start_url: '/StrikingTrial/',
        scope: '/StrikingTrial/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#1a1a2e',
        theme_color: '#1a1a2e',
        icons: [
          { src: '/StrikingTrial/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/StrikingTrial/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/StrikingTrial/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole app shell so it boots with the network unplugged.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // SPA fallback: a refresh or deep link while offline still resolves to
        // the app shell rather than a failed navigation.
        navigateFallback: '/StrikingTrial/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  base: '/StrikingTrial/',
  server: {
    // Dedicated port (5173 Call Change, 5181 Methodical). strictPort
    // means it fails loudly if 5181 is taken rather than silently moving elsewhere.
    port: 5182,
    strictPort: true,
  },
})
