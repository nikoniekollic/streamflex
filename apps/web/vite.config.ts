import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  plugins: [
    // lit tsr.config.json (routesDirectory, generatedRouteTree, autoCodeSplitting)
    tanstackRouter({ target: 'react' }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // vendors stables → cache navigateur long entre déploiements
        manualChunks: {
          react: ['react', 'react-dom'],
          router: ['@tanstack/react-router'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts'],
        },
      },
    },
  },
})
