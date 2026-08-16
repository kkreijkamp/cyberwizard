import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Relative base so the build works from any sub-path (GitHub Pages).
  base: './',
  build: {
    target: 'es2022',
  },
  test: {
    // LiteGraph runs headless — plain node is enough, no DOM shim needed.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
