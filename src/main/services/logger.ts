/**
 * 极简日志器 —— 输出到 stdout，并通过 EventBus 转发到 Renderer。
 *
 * 刻意不引入第三方日志库：v1 依赖 Python logging 的格式，
 * 这里只需要「时间 + 级别 + 模块 + 消息」四项。
 */

import { AsyncLocalStorage } from 'node:async_hooks'
export const runLogContext = new AsyncLocalStorage<{ workflowId: string; runId: string; stepId: string | null }>()

import type { LogLevel } from '@shared/types'

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warning: 30, error: 40 }

let minLevel: LogLevel = 'info'

export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

/** 日志订阅者（EventBus 在 Phase 3 接入） */
type Sink = (level: LogLevel, message: string, context?: { workflowId: string; runId: string; stepId: string | null }) => void
const sinks = new Set<Sink>()

export function addLogSink(sink: Sink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export interface Logger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
  /** 保留原始 Error 的 stack，写入 stderr */
  exception(message: string, error: unknown): void
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, message: string): void => {
    if (ORDER[level] < ORDER[minLevel]) return
    const line = `${timestamp()} [${level.toUpperCase()}] [${scope}] ${message}`
    if (level === 'error') process.stderr.write(`${line}\n`)
    else process.stdout.write(`${line}\n`)
    for (const sink of sinks) {
      try {
        sink(level, message, runLogContext.getStore())
      } catch {
        // 日志系统自身不得抛错
      }
    }
  }

  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warning', m),
    error: (m) => emit('error', m),
    exception: (m, error) => {
      emit('error', m)
      const detail = error instanceof Error ? (error.stack ?? error.message) : String(error)
      process.stderr.write(`${detail}\n`)
    }
  }
}
