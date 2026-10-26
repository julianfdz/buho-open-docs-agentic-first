/** El CLI (bin/buho-docs.mjs) también se ejecuta dentro de la app. */
declare module '*buho-docs.mjs' {
  export class CliExit extends Error {
    constructor(code: number)
    code: number
  }
  export function runCli(argv: string[], io: Record<string, unknown>): Promise<number>
}
