import { getMarkdownTheme, type MessageRenderer, type Theme } from '@earendil-works/pi-coding-agent';
import { Box, Markdown, Spacer, Text } from '@earendil-works/pi-tui';

export type ExpandableDetails = { expanded?: string; token?: number };

const EXPANDABLE_TYPES = new Set(['Commands', 'Tools']);

let latestToken: number | undefined;

function messageText(content: string | { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

export function createExpandableDetails(expanded: string): ExpandableDetails {
  const token = Date.now();
  latestToken = token;
  return { expanded, token };
}

export function restoreLatestExpandable(entries: ReadonlyArray<{ type: string; customType?: string; details?: unknown }>) {
  let max = 0;
  for (const entry of entries) {
    if (entry.type !== 'custom_message' || !EXPANDABLE_TYPES.has(entry.customType ?? '')) continue;
    const token = (entry.details as ExpandableDetails | undefined)?.token;
    if (typeof token === 'number' && token > max) max = token;
  }
  latestToken = max || undefined;
}

export function expandableBox(
  label: string,
  collapsed: string,
  expanded: string,
  options: { expanded: boolean; outputPad: number; hint?: boolean },
  theme: Theme,
) {
  const box = new Box(1, 1, (t) => theme.bg('customMessageBg', t));
  box.addChild(new Text(theme.fg('customMessageLabel', `\x1b[1m[${label}]\x1b[22m`), 0, 0));
  box.addChild(new Spacer(1));

  const mdTheme = getMarkdownTheme();
  const mdColor = { color: (t: string) => theme.fg('customMessageText', t) };
  const body = options.expanded ? expanded : collapsed;
  box.addChild(new Markdown(body, 0, 0, mdTheme, mdColor));

  if (options.hint) {
    box.addChild(new Spacer(1));
    box.addChild(new Text(theme.fg('dim', 'Ctrl+O to expand'), 0, 0));
  }

  return box;
}

export const expandableMessageRenderer: MessageRenderer<ExpandableDetails> = (message, options, theme) => {
  const collapsed = messageText(message.content);
  const expanded = message.details?.expanded ?? collapsed;
  const token = message.details?.token;
  const isLatest = token != null && token === latestToken;
  const showExpanded = options.expanded && isLatest;

  return expandableBox(
    message.customType,
    collapsed,
    expanded,
    { expanded: showExpanded, outputPad: options.outputPad, hint: !showExpanded && isLatest },
    theme,
  );
};
