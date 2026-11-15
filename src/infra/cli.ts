/** Explicit shell selection and Windows script invocation; arguments are PowerShell literals, never command text. */
export const psLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`
export function prepareArgv(command: string, platform = process.platform): string[] {
  return platform === 'win32' ? ['pwsh', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] : ['sh', '-c', command]
}
export function cliArgv(argv: readonly string[], platform = process.platform): string[] {
  if (platform !== 'win32' || !/\.(cmd|bat|ps1)$/i.test(argv[0] ?? '')) return [...argv]
  return prepareArgv(`$__dsh_cli_args = @(${argv.slice(1).map(psLiteral).join(',')}); & ${psLiteral(argv[0]!)} @__dsh_cli_args; $__dsh_cli_ok = $?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $__dsh_cli_ok) { exit 1 }`, platform)
}
/** Merge case-insensitively on Windows, preserving undefined tombstones for subprocess providers. */
export function mergeEnvironment(...layers: Readonly<Record<string, string | undefined>>[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  for (const layer of layers) for (const [key, value] of Object.entries(layer)) {
    if (process.platform === 'win32') for (const prior of Object.keys(result)) if (prior.toLowerCase() === key.toLowerCase()) delete result[prior]
    result[key] = value
  }
  return result
}
