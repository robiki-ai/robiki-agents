/**
 * Trims and truncates a string to at most `max` Unicode characters, adding an ellipsis.
 *
 * @param s - Raw input (often a description).
 * @param max - Maximum length including the ellipsis character when truncated.
 * @returns Trimmed string, possibly truncated with a trailing ellipsis.
 *
 * @example
 * clip('hello world', 8);
 */
export function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}
