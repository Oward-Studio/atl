/**
 * Minimal ANSI colours, no dependency.
 * Disabled outside a TTY, with NO_COLOR, or through --no-color (see setColorEnabled).
 */
const CSI = `${String.fromCharCode(27)}[`

let enabled = process.stdout.isTTY === true && !process.env['NO_COLOR']

export function setColorEnabled(value: boolean): void {
  enabled = value
}

export function isColorEnabled(): boolean {
  return enabled
}

const wrap =
  (open: string, close: string) =>
  (s: string): string =>
    enabled ? `${CSI}${open}m${s}${CSI}${close}m` : s

export const color = {
  bold: wrap('1', '22'),
  dim: wrap('2', '22'),
  underline: wrap('4', '24'),
  red: wrap('31', '39'),
  green: wrap('32', '39'),
  yellow: wrap('33', '39'),
  blue: wrap('34', '39'),
  magenta: wrap('35', '39'),
  cyan: wrap('36', '39'),
  grey: wrap('90', '39'),
  /** No 16-colour ANSI code for orange (High priority): 256-colour palette. */
  orange: wrap('38;5;208', '39'),
}

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** Visible length: ignores ANSI sequences. */
export function visibleLength(s: string): number {
  return Array.from(stripAnsi(s)).length
}
