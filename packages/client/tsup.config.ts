import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: { resolve: ['@loom/protocol', '@loom/distill', '@loom/crypto'] },
  clean: true,
  noExternal: ['@loom/protocol', '@loom/distill', '@loom/crypto'],
})
