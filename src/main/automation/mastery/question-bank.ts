import { randomUUID } from 'node:crypto'
import type { Database } from '../../storage/database'

export type MasteryQuestionType = 'single' | 'multi' | 'judge'
export interface MasteryQuestionOption { id: string; content: string; isCorrect: boolean; position: number }
export interface MasteryQuestion { id: string; content: string; type: MasteryQuestionType; attemptCount: number; options: MasteryQuestionOption[] }

export function normalizeOptionText(text: string): string {
  return text.trim().replace(/^[（(]?\s*[A-Fa-f①②③④⑤⑥⑦⑧⑨⑩]\s*[)）.、。:：\s]+/, '').replace(/\s+/g, ' ').trim()
}

/** Persistent question bank used by mastery practice. It never stores credentials or page data. */
export class MasteryQuestionBank {
  constructor(private readonly db: Database) {}

  getOrCreate(content: string, type: MasteryQuestionType, optionTexts: string[]): MasteryQuestion {
    const clean = optionTexts.map((item) => item.trim()).filter(Boolean)
    const raw = this.db.raw()
    let row = raw.prepare('SELECT id, content, question_type, attempt_count FROM mastery_questions WHERE content=? AND question_type=?').get(content, type) as { id:string; content:string; question_type:MasteryQuestionType; attempt_count:number } | undefined
    const now = new Date().toISOString()
    if (!row) {
      const id = randomUUID()
      raw.prepare('INSERT INTO mastery_questions (id,content,question_type,attempt_count,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id, content, type, 0, now, now)
      row = { id, content, question_type: type, attempt_count: 0 }
    }
    const existing = raw.prepare('SELECT id,content,normalized_content,is_correct,position FROM mastery_options WHERE question_id=? ORDER BY position').all(row.id) as Array<{id:string;content:string;normalized_content:string;is_correct:number;position:number}>
    const byNorm = new Map(existing.map((item) => [item.normalized_content, item]))
    for (let index = 0; index < clean.length; index += 1) {
      const text = clean[index]; const norm = normalizeOptionText(text); const found = byNorm.get(norm)
      if (found) {
        raw.prepare('UPDATE mastery_options SET content=?, position=? WHERE id=?').run(text, index, found.id)
      } else {
        raw.prepare('INSERT INTO mastery_options (id,question_id,content,normalized_content,is_correct,position) VALUES (?,?,?,?,0,?)').run(randomUUID(), row.id, text, norm, index)
      }
    }
    return this.read(row.id)!
  }

  read(id: string): MasteryQuestion | null {
    const raw = this.db.raw()
    const row = raw.prepare('SELECT id,content,question_type,attempt_count FROM mastery_questions WHERE id=?').get(id) as {id:string;content:string;question_type:MasteryQuestionType;attempt_count:number} | undefined
    if (!row) return null
    const options = raw.prepare('SELECT id,content,is_correct,position FROM mastery_options WHERE question_id=? ORDER BY position').all(id) as Array<{id:string;content:string;is_correct:number;position:number}>
    return { id: row.id, content: row.content, type: row.question_type, attemptCount: row.attempt_count, options: options.map((item) => ({ id:item.id, content:item.content, isCorrect:item.is_correct === 1, position:item.position })) }
  }

  knownIndices(question: MasteryQuestion, optionTexts: string[]): number[] {
    const known = new Set(question.options.filter((option) => option.isCorrect).map((option) => normalizeOptionText(option.content)))
    const indices = optionTexts.map((text, index) => known.has(normalizeOptionText(text)) ? index : -1).filter(index => index >= 0)
    return indices.length === known.size ? indices : []
  }

  choose(question: MasteryQuestion, optionTexts: string[]): number[] {
    const known = this.knownIndices(question, optionTexts)
    if (known.length) return known
    const n = optionTexts.length
    if (n < 2) throw new Error('题目至少需要两个选项')
    if (question.type === 'multi') {
      const mask = BigInt(question.attemptCount) % ((1n << BigInt(n)) - 1n) + 1n
      return optionTexts.map((_, index) => index).filter(index => (mask & (1n << BigInt(index))) !== 0n)
    }
    return [question.attemptCount % n]
  }

  markAttempt(questionId: string, hadKnownAnswer: boolean): void {
    const raw = this.db.raw()
    this.db.transaction(() => {
      if (hadKnownAnswer) raw.prepare('UPDATE mastery_options SET is_correct=0 WHERE question_id=?').run(questionId)
      raw.prepare("UPDATE mastery_questions SET attempt_count=attempt_count+1, updated_at=datetime('now') WHERE id=?").run(questionId)
    })
  }

  saveCorrect(content: string, type: MasteryQuestionType, optionTexts: string[], correctIndices: number[]): MasteryQuestion {
    const question = this.getOrCreate(content, type, optionTexts)
    const correct = new Set(correctIndices)
    const raw = this.db.raw()
    this.db.transaction(() => {
      raw.prepare('UPDATE mastery_options SET is_correct=0 WHERE question_id=?').run(question.id)
      const update = raw.prepare('UPDATE mastery_options SET is_correct=? WHERE question_id=? AND normalized_content=?')
      for (let index = 0; index < optionTexts.length; index += 1) update.run(correct.has(index) ? 1 : 0, question.id, normalizeOptionText(optionTexts[index]))
      raw.prepare("UPDATE mastery_questions SET updated_at=datetime('now') WHERE id=?").run(question.id)
    })
    return this.read(question.id)!
  }
}
