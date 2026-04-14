/// <reference types="vite/client" />
declare module "*.tsx";

interface ImportMetaEnv {
    readonly URL_API: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
