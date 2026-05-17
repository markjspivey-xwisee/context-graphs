import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the Foxxi dashboard.
//
// The dashboard talks to the Foxxi vertical bridge for live data
// (default http://localhost:6080). Override via VITE_FOXXI_BRIDGE_URL.
// If the bridge isn't reachable, the app falls back to bundled sample
// data so it works offline.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
