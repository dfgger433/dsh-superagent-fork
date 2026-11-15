import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
// `?raw` imports a file as its text, as Vite and vitest do; tsdown refuses `.css` ids without @tsdown/css, so this loads them.
const raw = { name: 'raw',
  resolveId: (source: string, importer?: string) => source.endsWith('?raw') && importer ? resolve(dirname(importer), source) : undefined,
  load: (id: string) => id.endsWith('?raw') ? { code: `export default ${JSON.stringify(readFileSync(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' as const }
    : undefined }
export default defineConfig([
  // Build public Host entries independently: HMR caches each entry URL, so an entry must never export another entry's private aliases.
  ...Object.entries({ index: 'src/index.ts', 'github-watch': 'src/sources/github.ts', 'feishu-watch': 'src/sources/feishu.ts', 'execution-scope': 'src/execution-scope.ts', 'worker-composition': 'src/worker-composition.ts' }).map(([name, source]) => defineConfig({
    entry: { [name]: source }, outDir: 'lib', format: 'esm', outputOptions: { codeSplitting: false }, fixedExtension: false,
    platform: 'node', target: 'es2024', dts: true, clean: false, deps: { neverBundle: [/^@deepseek-ai\//, 'zod', 'proper-lockfile'] },
  })),
  { entry: { client: 'src/client/index.tsx' }, outDir: 'lib', format: 'cjs', platform: 'browser', dts: false, clean: false, plugins: [raw],
    deps: { neverBundle: ['react', 'react/jsx-runtime', 'react-dom'] },
    outputOptions: { entryFileNames: 'client.js', banner: 'window.__ModuleLoader__.load({ id: "dsh-superagent", factory: (require) => {', footer: 'return module.exports; } });', intro: 'var module = { exports: {} }; var exports = module.exports;' } },
])
