import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  noExternal: ['@loom/protocol', '@loom/distill', '@loom/crypto'],
})
