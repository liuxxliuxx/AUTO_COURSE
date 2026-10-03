import { isAccentColor } from '@shared/appearance'

/** Keep white button labels readable for every saved accent family. */
export function accentLightness(value: unknown): number {
  const lightness = { blue: 46, teal: 30, violet: 50, rose: 44, orange: 38 }
  return isAccentColor(value) ? lightness[value] : lightness.blue
}
