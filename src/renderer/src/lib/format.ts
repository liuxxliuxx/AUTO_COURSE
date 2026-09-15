/** 展示层格式化工具。 */

/** 秒 → `H:MM:SS`；不足一小时省略小时位，未知传 null 显示占位。 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--'
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 分钟 → `H:MM:SS`（用于「目标 120 分钟」这类配置值）。 */
export function formatMinutes(minutes: number): string {
  return formatDuration(minutes * 60)
}

/** epoch ms → `14:02:11` */
export function formatClock(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 0-100 的百分比，clamp 后保留整数。 */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** `HH:mm` 字符串是否合法 */
export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
}
