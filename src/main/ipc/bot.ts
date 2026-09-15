/** Bot / 验证码 / 调度 / 进度 / 浏览器窗口 相关 IPC。 */

import { IPC_INVOKE } from '@shared/ipc'
import { handle } from './handle'
import type { ServiceContainer } from '../services/container'
import { createLogger } from '../services/logger'

const logger = createLogger('ipc:bot')

export function registerBotIpc(container: ServiceContainer): void {
  // ------------------------------------------------------------------- Bot

  handle(IPC_INVOKE.botStart, () => container.bot.start())

  handle(IPC_INVOKE.botStop, async () => {
    await container.bot.stop('user')
  })

  handle(IPC_INVOKE.botStatus, () => container.bot.getStatus())

  // --------------------------------------------------------------- 验证码

  handle(IPC_INVOKE.captchaConfirm, () => {
    container.bot.confirmCaptcha()
    logger.info('用户确认验证码已处理')
  })

  // --------------------------------------------------------------- 调度

  handle(IPC_INVOKE.schedulerGet, () => container.scheduler.getStatus())

  handle(IPC_INVOKE.schedulerUpdate, (patch) => {
    const settingsPatch: Record<string, unknown> = {}
    if (patch.enabled !== undefined) settingsPatch.autoMode = patch.enabled
    if (patch.startTime !== undefined) settingsPatch.autoStartTime = patch.startTime
    if (patch.endTime !== undefined) settingsPatch.autoEndTime = patch.endTime
    if (patch.allDay !== undefined) settingsPatch.autoAllDay = patch.allDay
    if (patch.dailyLimitMinutes !== undefined) {
      settingsPatch.autoLimitMinutes = patch.dailyLimitMinutes
    }
    container.settings.update(settingsPatch)
    container.broadcastSettings()
    return container.scheduler.getStatus()
  })

  // --------------------------------------------------------------- 进度

  handle(IPC_INVOKE.progressGet, () => container.progressSnapshot())

  // --------------------------------------------------------------- 浏览器

  handle(IPC_INVOKE.browserOpenCourseWindow, async () => {
    const session = await container.browser.ensureSession()
    const url = session.getCurrentUrl()
    logger.info(`课程窗口已打开: ${url}`)
  })

  // --------------------------------------------------------------- 转录
  // Phase 6 接入真实转录服务前，先返回一个稳定的空闲状态。

  handle(IPC_INVOKE.transcriptionGet, () => ({
    phase: 'idle' as const,
    title: null,
    completed: 0,
    failed: 0,
    message: '转录未启用',
    tone: 'neutral' as const,
    percent: null
  }))
}
