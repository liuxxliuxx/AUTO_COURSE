/**
 * 进程内事件总线。
 *
 * 取代 v1 的「多个 Queue + QTimer 轮询」：
 *   v1: Bot 线程 → queue.Queue → QTimer 每 200/500ms 轮询 → QML
 *   v2: Service → EventBus → IPC → Renderer
 *
 * 事件名与负载类型直接复用 @shared/ipc 的 EventPayloads，
 * 保证「能发出的」与「IPC 能转发的」永远是同一套。
 *
 * 约定：Bot / Runner 只 emit，不 import 任何 Electron 或 Renderer 代码。
 */

import type { EventPayloads, EventName } from '@shared/ipc'
import { createLogger } from './logger'

const logger = createLogger('event-bus')

export type Unsubscribe = () => void

export class EventBus {
  private listeners = new Map<EventName, Set<(payload: never) => void>>()

  on<E extends EventName>(event: E, handler: (payload: EventPayloads[E]) => void): Unsubscribe {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(handler as (payload: never) => void)
    return () => {
      set?.delete(handler as (payload: never) => void)
    }
  }

  emit<E extends EventName>(event: E, payload: EventPayloads[E]): void {
    const set = this.listeners.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        ;(handler as (p: EventPayloads[E]) => void)(payload)
      } catch (error) {
        // 单个订阅者出错不得影响其他订阅者
        logger.exception(`事件 ${event} 的订阅者抛错`, error)
      }
    }
  }

  /** 仅在测试/退出时使用 */
  clear(): void {
    this.listeners.clear()
  }
}
