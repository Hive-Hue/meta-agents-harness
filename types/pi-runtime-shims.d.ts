declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionContext {
    cwd: string;
    hasUI?: boolean;
    ui: any;
    model?: any;
    [key: string]: any;
  }

  export interface ExtensionAPI {
    registerCommand(name: string, spec: { description?: string; handler: (args: string, ctx: ExtensionContext) => any }): void;
    registerShortcut(key: string, spec: { description?: string; handler: (ctx: ExtensionContext) => any }): void;
    registerTool(spec: any): void;
    on(event: string, handler: (event: any, ctx: ExtensionContext) => any): void;
  }
  export const isToolCallEventType: any;
}

declare module "@mariozechner/pi-ai" {
  export type AssistantMessage = any;
}

declare module "@mariozechner/pi-tui" {
  export const Text: any;
  export const truncateToWidth: any;
  export const visibleWidth: any;
  export const Key: any;
  export const matchesKey: any;
}

declare module "@sinclair/typebox" {
  export const Type: any;
}

declare module "node:fs" {
  export const appendFileSync: any;
  export const existsSync: any;
  export const readdirSync: any;
  export const readFileSync: any;
  export const statSync: any;
  export const writeFileSync: any;
  export const mkdirSync: any;
  export const unlinkSync: any;
  export const cpSync: any;
  export const rmSync: any;
  export const mkdtempSync: any;
}

declare module "node:path" {
  export const basename: any;
  export const dirname: any;
  export const join: any;
  export const relative: any;
  export const resolve: any;
}

declare module "node:url" {
  export const fileURLToPath: any;
}

declare module "node:child_process" {
  export const spawnSync: any;
}

declare module "node:os" {
  export const homedir: any;
  const defaultExport: any;
  export default defaultExport;
}

declare module "fs" {
  export const appendFileSync: any;
  export const existsSync: any;
  export const readdirSync: any;
  export const readFileSync: any;
  export const statSync: any;
  export const writeFileSync: any;
  export const mkdirSync: any;
  export const unlinkSync: any;
  export const cpSync: any;
  export const rmSync: any;
  export const mkdtempSync: any;
}

declare module "path" {
  export const basename: any;
  export const dirname: any;
  export const join: any;
  export const relative: any;
  export const resolve: any;
}

declare module "url" {
  export const fileURLToPath: any;
}

declare module "child_process" {
  export type ChildProcessWithoutNullStreams = any;
  export const spawnSync: any;
  export const spawn: any;
  export const execSync: any;
}

declare module "http" {
  export const createServer: any;
}

declare module "crypto" {
  export const createHash: any;
  export const randomUUID: any;
  export const randomBytes: any;
}

declare const process: any;
declare type Buffer = any;
declare const Buffer: any;
