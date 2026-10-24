/// <reference types="vite/client" />

declare const __APP_VERSION__: string
declare const __BUILD_TIME__: string

interface Navigator {
  /** iOS Safari only; used to recognise installed mode on the tablet. */
  readonly standalone?: boolean
}
