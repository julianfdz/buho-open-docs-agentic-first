declare module 'pagedjs-esm' {
  export class Previewer {
    preview(content?: Node | string, stylesheets?: (string | Record<string, string>)[], renderTo?: HTMLElement): Promise<{ total: number }>
  }
}
