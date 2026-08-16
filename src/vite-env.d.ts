/// <reference types="vite/client" />


declare module "@tauri-apps/plugin-dialog" {
  export interface SaveDialogOptions {
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }
  export function save(options?: SaveDialogOptions): Promise<string | null>;
}
