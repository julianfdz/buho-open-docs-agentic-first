/// <reference types="vite/client" />
import type { BuhoDocsApi } from '@shared/types'

declare global {
  interface Window {
    buho: BuhoDocsApi
  }
}
