import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Descubrible por cualquier agente: deja la skill `buho-docs` (SKILL.md, formato Agent Skills) en la
 * carpeta de skills de cada agente instalado en el PC, para que cualquier sesión nueva sepa que existe
 * Búho Docs y cómo usar su CLI sin que nadie se lo diga.
 * - Solo si el agente está instalado (existe su carpeta en el perfil del usuario).
 * - No pisa una skill «buho-docs» puesta a mano: solo actualiza las que lleven nuestra marca.
 * - Se actualiza en cada arranque si la guía ha cambiado; el desinstalador las quita.
 */
const AGENTS: { name: string; home: string }[] = [
  { name: 'Claude Code', home: '.claude' },
  { name: 'Codex', home: '.codex' },
  { name: 'GitHub Copilot', home: '.copilot' }
]
const MARK = '.instalado-por-buho-docs'

export interface SkillTarget {
  agent: string
  path: string
  status: 'instalada' | 'actualizada' | 'al día' | 'manual'
}

export function syncAgentSkills(skillFile: string, version: string): SkillTarget[] {
  if (!existsSync(skillFile)) return []
  const content = readFileSync(skillFile, 'utf8')
  const out: SkillTarget[] = []
  for (const a of AGENTS) {
    const home = join(homedir(), a.home)
    if (!existsSync(home)) continue
    const dir = join(home, 'skills', 'buho-docs')
    const target = join(dir, 'SKILL.md')
    try {
      if (existsSync(dir) && !existsSync(join(dir, MARK))) {
        out.push({ agent: a.name, path: target, status: 'manual' })
        continue
      }
      const current = existsSync(target) ? readFileSync(target, 'utf8') : null
      if (current === content) {
        out.push({ agent: a.name, path: target, status: 'al día' })
        continue
      }
      mkdirSync(dir, { recursive: true })
      writeFileSync(target, content)
      writeFileSync(join(dir, MARK), `Búho Docs ${version}: esta skill la instala y actualiza la app. Si la editas a mano, borra este archivo para que no la pise.\r\n`)
      out.push({ agent: a.name, path: target, status: current === null ? 'instalada' : 'actualizada' })
    } catch {
      /* carpeta sin permisos: se intenta en el próximo arranque */
    }
  }
  return out
}
