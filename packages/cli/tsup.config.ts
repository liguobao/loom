import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  clean: true,
  define: { LOOM_CLI_VERSION: JSON.stringify(version) },
  noExternal: ['@loom/distill', '@loom/protocol'],
})
