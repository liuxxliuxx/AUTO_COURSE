import { afterEach, describe, expect, it } from 'vitest'
import { Database } from '../../src/main/storage/database'
import { MasteryQuestionBank } from '../../src/main/automation/mastery/question-bank'

let db: Database | undefined
afterEach(() => db?.close())

describe('掌握度题库', () => {
  it('持久化题目、选项和试错次数', () => {
    db = new Database(':memory:')
    const bank = new MasteryQuestionBank(db)
    const q = bank.getOrCreate('题目 A', 'single', ['A.甲', 'B.乙', 'C.丙'])
    expect(bank.choose(q, ['A.甲', 'B.乙', 'C.丙'])).toEqual([0])
    bank.markAttempt(q.id, false)
    const next = bank.read(q.id)!
    expect(next.attemptCount).toBe(1)
    expect(bank.choose(next, ['A.甲', 'B.乙', 'C.丙'])).toEqual([1])
  })

  it('多选题按非空子集轮换，解析确认后固定答案', () => {
    db = new Database(':memory:')
    const bank = new MasteryQuestionBank(db)
    let q = bank.getOrCreate('题目 B', 'multi', ['A.甲', 'B.乙', 'C.丙'])
    expect(bank.choose(q, q.options.map((item) => item.content))).toEqual([0])
    bank.markAttempt(q.id, false)
    q = bank.read(q.id)!
    expect(bank.choose(q, q.options.map((item) => item.content))).toEqual([1])
    bank.saveCorrect(q.content, q.type, q.options.map((item) => item.content), [0, 2])
    q = bank.read(q.id)!
    expect(bank.choose(q, ['甲', '乙', '丙'])).toEqual([0, 2])
  })

  it('已知答案答错时清除旧答案并继续推进 attempt_count', () => {
    db = new Database(':memory:')
    const bank = new MasteryQuestionBank(db)
    const q = bank.saveCorrect('题目 C', 'single', ['甲', '乙'], [0])
    expect(bank.choose(q, ['甲', '乙'])).toEqual([0])
    bank.markAttempt(q.id, true)
    const retried = bank.read(q.id)!
    expect(retried.attemptCount).toBe(1)
    expect(bank.choose(retried, ['甲', '乙'])).toEqual([1])
  })
})
