/**
 * 文件名净化 —— 逐条对照 v1
 * `src/transcriber/transcription_manager.py::sanitize_filename`。
 *
 * 这个函数决定转录输出目录与文件名，行为必须与 v1 完全一致，
 * 否则用户已有的「课程录音」目录会被重新建一份。
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_COURSE_NAME, sanitizeCourseNote, sanitizeFilename } from '../../src/main/util/filename'

describe('sanitizeFilename', () => {
  it('空值返回默认课程名', () => {
    expect(sanitizeFilename('')).toBe(DEFAULT_COURSE_NAME)
    expect(sanitizeFilename('未命名课程')).toBe('未命名课程')
  })

  it('替换 Windows 非法字符', () => {
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('连续下划线或空格折叠成一个下划线', () => {
    expect(sanitizeFilename('a  b')).toBe('a_b')
    expect(sanitizeFilename('a__b')).toBe('a_b')
    expect(sanitizeFilename('a_ b')).toBe('a_b')
    expect(sanitizeFilename('a   _   b')).toBe('a_b')
  })

  it('去掉首尾的点', () => {
    expect(sanitizeFilename('..name..')).toBe('name')
    expect(sanitizeFilename('...')).toBe(DEFAULT_COURSE_NAME)
  })

  /**
   * 注意顺序：v1 先折叠连续空格为下划线，再 strip('. ')。
   * 所以首尾的**空格**会先变成下划线，strip 就再也去不掉了 ——
   * '  name  ' 得到 '_name_' 而不是 'name'。
   * 这是 v1 的既有行为，v2 原样保留（改掉会让老目录对不上）。
   */
  it('首尾空格会先被折叠成下划线（v1 行为）', () => {
    expect(sanitizeFilename('  name  ')).toBe('_name_')
    expect(sanitizeFilename('   ')).toBe('_')
  })

  it('超长截断到 100 字符', () => {
    const long = 'x'.repeat(250)
    expect(sanitizeFilename(long)).toHaveLength(100)
  })

  it('保留中文与常见符号', () => {
    expect(sanitizeFilename('艺术与审美')).toBe('艺术与审美')
    expect(sanitizeFilename('1.2 艺术的起源')).toBe('1.2 艺术的起源')
    expect(sanitizeFilename('第（一）章 - 绪论')).toBe('第（一）章 - 绪论')
  })

  it('典型课程名不被改动', () => {
    // 用户库里的真实数据
    for (const name of ['艺术与审美', '创新创业', '大学英语（三）']) {
      expect(sanitizeFilename(name)).toBe(name)
    }
  })

  it('自定义长度上限', () => {
    expect(sanitizeFilename('abcdefghij', 5)).toBe('abcde')
  })
})

describe('sanitizeCourseNote', () => {
  it('与 sanitizeFilename 同源（v1 缺陷 #2 的兼容键）', () => {
    expect(sanitizeCourseNote('艺术:审美')).toBe('艺术_审美')
    expect(sanitizeCourseNote('艺术与审美')).toBe('艺术与审美')
  })
})
