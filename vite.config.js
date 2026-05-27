import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['maplibre-gl', '@tomtom-org/maps-sdk/map', '@tomtom-org/maps-sdk/services', '@tomtom-org/maps-sdk/core'],
  },
  server: {
    host: true,
  },
  preview: {
    host: true,
  },
})
