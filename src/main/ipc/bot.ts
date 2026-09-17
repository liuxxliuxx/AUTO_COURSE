/** Bot / 验证码 / 调度 / 进度 / 浏览器窗口 相关 IPC。 */

import { IPC_INVOKE } from '@shared/ipc'
import { handle } from './handle'
import type { ServiceContainer } from '../services/container'
import { createLogger } from '../services/logger'

const logger = createLogger('ipc:bot')

export function registerBotIpc(container: ServiceContainer): void {
  // ------------------------------------------------------------------- Bot

  handle(IPC_INVOKE.botStart, (request) => container.bot.start(request))

  handle(IPC_INVOKE.botStop, async () => {
    await container.bot.stop('user')
  })

  handle(IPC_INVOKE.botStatus, () => container.bot.getStatus())

  // ----------------------------------------------------------- 人工介入

  handle(IPC_INVOKE.interventionConfirm, () => {
    container.bot.confirmIntervention()
    logger.info('用户确认人工处理已完成')
  })

  // --------------------------------------------------------------- 调度

  handle(IPC_INVOKE.schedulerGet, () => container.scheduler.getStatus())

  handle(IPC_INVOKE.schedulerUpdate, (patch) => {
    const config = { ...container.scheduler.getConfig(), ...patch }
    if (config.enabled && (!config.courseId || !container.courses.get(config.courseId))) throw new Error('请选择有效的调度课程')
    const validTime = (value: string): boolean => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
    if (!config.allDay && (!validTime(config.startTime) || !validTime(config.endTime))) throw new Error('时间格式应为 HH:mm')
    if (!Number.isInteger(config.dailyLimitMinutes) || config.dailyLimitMinutes < 0) throw new Error('每日目标必须为非负整数分钟')
    if (patch.courseId !== undefined) container.db.setSetting('schedulerCourseId', patch.courseId ?? '')
    const settingsPatch: Record<string, unknown> = {}
    if (patch.enabled !== undefined) settingsPatch.autoMode = patch.enabled
    if (patch.startTime !== undefined) settingsPatch.autoStartTime = patch.startTime
    if (patch.endTime !== undefined) settingsPatch.autoEndTime = patch.endTime
    if (patch.allDay !== undefined) settingsPatch.autoAllDay = patch.allDay
    if (patch.dailyLimitMinutes !== undefined) {
      settingsPatch.autoLimitMinutes = patch.dailyLimitMinutes
    }
    container.settings.update(settingsPatch)
    container.scheduler.resume()
    container.broadcastSettings()
    return container.scheduler.getStatus()
  })

  // --------------------------------------------------------------- 进度

  handle(IPC_INVOKE.progressGet, () => container.progressSnapshot())

  // --------------------------------------------------------------- 浏览器

  // 只有用户主动点按钮才会走到这里，所以在这里显式把课程窗口拉到前台。
  handle(IPC_INVOKE.browserOpenCourseWindow, async () => {
    const session = await container.browser.ensureSession()
    const url = session.getCurrentUrl()
    await container.browser.focusCourseWindow()
    logger.info(`课程窗口已打开: ${url}`)
  })

  // --------------------------------------------------------------- 转录

  handle(IPC_INVOKE.transcriptionGet, () => container.transcription.getStatus())
}
