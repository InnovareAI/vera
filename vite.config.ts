import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Source maps un-minify the bundle for anyone who fetches the .js.map
    // file. Off in prod so the deployed JS stays harder to read. DevTools
    // can still inspect, but variable names + comments + module structure
    // stop being trivially recoverable. Default minifier (oxc / rolldown)
    // already strips whitespace and shortens identifiers.
    sourcemap: false,
  },
})
