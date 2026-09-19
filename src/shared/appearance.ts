/** Supported accent families. Semantic warning/error colors remain independent. */
export const ACCENT_COLORS = [
  { id: 'blue', label: '蓝色（默认）', hue: 218 },
  { id: 'teal', label: '青绿', hue: 166 },
  { id: 'violet', label: '紫色', hue: 260 },
  { id: 'rose', label: '玫瑰', hue: 338 },
  { id: 'orange', label: '橙色', hue: 28 }
] as const
export type AccentColor = typeof ACCENT_COLORS[number]['id']
export const DEFAULT_ACCENT: AccentColor = 'blue'
export function isAccentColor(value: unknown): value is AccentColor {
  return ACCENT_COLORS.some(color => color.id === value)
}
export function accentHue(value: unknown): number {
  return (ACCENT_COLORS.find(color => color.id === value) ?? ACCENT_COLORS[0]).hue
}
