/**
 * Versión portable: copia dist/win-unpacked a una carpeta «Buho Docs», le añade portable.txt (activa el
 * modo portable: los datos van en «datos» junto a la app) y la comprime en dist/Buho-Docs-<v>-portable.zip.
 * Se ejecuta después de electron-builder (npm run dist / npm run dist:portable).
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const src = join(root, 'dist', 'win-unpacked')
if (!existsSync(join(src, 'BuhoDocs.exe'))) throw new Error('Falta dist/win-unpacked: ejecuta antes electron-builder')

const stage = join(root, 'dist', 'portable')
const folder = join(stage, 'Buho Docs')
rmSync(stage, { recursive: true, force: true })
cpSync(src, folder, { recursive: true })

writeFileSync(
  join(folder, 'portable.txt'),
  [
    'Búho Docs · versión portable (Buho Corps Systems)',
    '',
    'Este archivo activa el modo portable: ajustes, recientes e historial de cambios',
    'se guardan en la carpeta «datos» de aquí al lado, no en el PC. Puedes llevar la carpeta en un USB o en la nube.',
    'Si borras este archivo, la app guarda los datos en %APPDATA%\\BuhoDocs como la versión instalada.',
    '',
    'Abrir: BuhoDocs.exe',
    'Agentes de IA: cli\\buho-docs.cmd (PowerShell/cmd) o cli/buho-docs (Git Bash/WSL). Guía: SKILL.md',
    'La versión portable no añade nada al PC (ni PATH ni menú contextual): para eso usa el instalador.',
    ''
  ].join('\r\n')
)

const zip = join(root, 'dist', `Buho-Docs-${version}-portable.zip`)
rmSync(zip, { force: true })
// tar de Windows (bsdtar) crea .zip con -a según la extensión; ruta completa para no coger el tar de Git.
const tar = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
execFileSync(tar, ['-a', '-c', '-f', zip, '-C', stage, 'Buho Docs'], { stdio: 'inherit' })
rmSync(stage, { recursive: true, force: true })
console.log(`Portable: ${zip}`)
