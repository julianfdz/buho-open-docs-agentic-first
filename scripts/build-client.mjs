/**
 * Compila el cliente nativo del CLI (client/BuhoDocsCli.cs → out-cli/buho-docs.exe) con el csc.exe de
 * .NET Framework que trae Windows: no hace falta instalar nada. El instalador lo pone en <instalación>\cli.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const win = process.env.SystemRoot || 'C:\\Windows'
const csc = [join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find((p) => existsSync(p))
if (!csc) throw new Error('No encuentro csc.exe (.NET Framework 4) en este Windows')
mkdirSync(join(root, 'out-cli'), { recursive: true })
execFileSync(
  csc,
  ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/win32icon:${join(root, 'build', 'icon.ico')}`, `/out:${join(root, 'out-cli', 'buho-docs.exe')}`, join(root, 'client', 'BuhoDocsCli.cs')].filter((a) => !a.startsWith('/win32icon:') || existsSync(a.slice(11))),
  { stdio: 'inherit' }
)
console.log('Cliente: out-cli/buho-docs.exe')
