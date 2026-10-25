import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        // Paged.js publica su versión ESM empaquetada fuera del mapa de exports.
        'pagedjs-esm': resolve('node_modules/pagedjs/dist/paged.esm.js')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          // La vista previa es una página aparte: va dentro de un iframe en la app y es la que se imprime a PDF.
          preview: resolve('src/renderer/preview.html')
        }
      }
    },
    plugins: [react()]
  }
})
