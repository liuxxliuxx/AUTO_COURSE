/** `fixture-server.mjs` 的类型声明，供 TypeScript 测试文件复用（避免重复实现）。 */

export interface FixtureServer {
  origin: string
  close: () => Promise<void>
}

export function startFixtureServer(rootDir: string): Promise<FixtureServer>
