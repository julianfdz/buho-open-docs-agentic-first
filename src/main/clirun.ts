import { runCli, CliExit } from '../../bin/buho-docs.mjs'
import { ROUTES, type ApiCall } from './api'

/**
 * CLI siempre activo: con la app abierta, `buho-docs.exe` (cliente nativo de unos milisegundos) manda
 * el comando aquí y se ejecuta dentro de la app, con la misma lógica que el CLI de Node pero sin
 * arrancar un proceso nuevo ni pasar por HTTP para cada llamada a la API. Cada petición tiene su propia
 * salida: se atienden muchas a la vez.
 */
export async function runInApp(api: ApiCall, argv: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  let stdout = ''
  let stderr = ''
  const call = async (method: string, path: string, body?: Record<string, unknown>): Promise<unknown> => {
    const u = new URL(path, 'http://app')
    const name = ROUTES[`${method} ${u.pathname}`]
    if (!name) {
      stderr += `Error: ruta desconocida ${method} ${u.pathname}\n`
      throw new CliExit(1)
    }
    try {
      const r = await api(name, { ...Object.fromEntries(u.searchParams), ...(body ?? {}) })
      // Igual que por HTTP: lo que vuelve es JSON.
      return r === undefined ? r : JSON.parse(JSON.stringify(r))
    } catch (e) {
      if (e instanceof CliExit) throw e
      stderr += `Error: ${e instanceof Error ? e.message : String(e)}\n`
      throw new CliExit(1)
    }
  }
  const io = {
    cwd,
    env: process.env,
    stdin: null,
    call,
    out: (t: string) => {
      stdout += t
    },
    err: (t: string) => {
      stderr += t
    }
  }
  try {
    const code = await runCli(argv, io)
    return { stdout, stderr, code: code ?? 0 }
  } catch (e) {
    if (e instanceof CliExit) return { stdout, stderr, code: e.code }
    return { stdout, stderr: stderr + String((e as Error)?.stack ?? e) + '\n', code: 1 }
  }
}
