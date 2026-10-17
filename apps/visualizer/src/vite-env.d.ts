/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Driver base URL, e.g. http://localhost:8000 */
  readonly VITE_DRIVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
