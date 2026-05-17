/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FOXXI_BRIDGE_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
