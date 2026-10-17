import { afterEach, describe, expect, it, vi } from 'vitest'
import { MasteryCourseRunner } from '../../src/main/automation/mastery/mastery-course-runner'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import type { RunnerContext } from '../../src/main/automation/runner'
import { CaptchaService } from '../../src/main/automation/captcha'
import { readMasteryPoints, readMasteryRate } from '../../src/main/automation/mastery/dom'
vi.mock('../../src/main/automation/mastery/dom', () => ({ readMasteryPoints: vi.fn(), readMasteryRate: vi.fn(), scrollMasteryPanel: vi.fn(), clickImproveMastery: vi.fn().mockResolvedValue(true) }))
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks() })
function setup() {
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.spyOn(CaptchaService.prototype, 'checkAndHandle').mockResolvedValue(false)
  const ctx = { settings: { ...DEFAULT_SETTINGS, timeLimitMinutes: 1, skipCompleted: false }, credentials: {}, masteryQuestionBank: {},
    session: { navigate: vi.fn(), playwrightPage: { waitForTimeout: vi.fn(), on: vi.fn(), once: vi.fn() } }, log: { info: vi.fn() }, shouldStop: () => false,
    reportPhase: vi.fn(), reportCurrentTitle: vi.fn(), reportVideoCompleted: vi.fn(), reportVideoWatched: vi.fn(), sessionWatchedSeconds: () => 0,
    requestCaptcha: vi.fn()
  } as unknown as RunnerContext
  const runner = new MasteryCourseRunner(() => ({ method: 'zhihuishu', login: async () => { now += 120000; return { ok: true, alreadyLoggedIn: true, message: '' } } }))
  return { runner, ctx, advance: (ms: number) => { now += ms } }
}
describe('掌握度运行终止条件', () => {
  it('满级课程即使关闭跳过也正常结束，不将登录时间计入学习', async () => {
    const { runner, ctx } = setup()
    vi.mocked(readMasteryPoints).mockResolvedValue([{ name: '已掌握', rate: 100, status: 'green' }])
    expect(await runner.run(ctx)).toMatchObject({ reason: 'pool-exhausted', watchedSeconds: 0 })
  })
  it('重新读取目录失败不能报告课程全部完成', async () => {
    const { runner, ctx } = setup()
    vi.mocked(readMasteryPoints).mockResolvedValueOnce([{ name: '未完成', rate: 0, status: 'pink' }]).mockResolvedValue([])
    await expect(runner.run(ctx)).rejects.toThrow('目录未加载')
  })
  it('知识点没有完成时也能因时长限制退出', async () => {
    const { runner, ctx, advance } = setup()
    vi.mocked(readMasteryPoints).mockResolvedValue([{ name: '未完成', rate: 0, status: 'pink' }])
    vi.mocked(readMasteryRate).mockImplementation(async () => { advance(61000); return 0 })
    // Checkpoint before the next exam must stop, rather than wait until mastery reaches 100%.
    expect(await runner.run(ctx)).toMatchObject({ reason: 'time-limit', completedCount: 0, watchedSeconds: 61 })
  })
})
