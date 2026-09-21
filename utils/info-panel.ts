import {
  DynamicBorder,
  getSelectListTheme,
  type ExtensionAPI,
  type ExtensionContext,
  type Theme,
} from '@earendil-works/pi-coding-agent';
import {
  Container,
  Key,
  SelectList,
  Spacer,
  Text,
  matchesKey,
  type Component,
  type SelectItem,
  type TUI,
} from '@earendil-works/pi-tui';

const TABS = ['Commands', 'Tools', 'System'] as const;

function listBody(items: () => SelectItem[]): Component {
  let list: SelectList | undefined;
  return {
    invalidate: () => {
      list = undefined;
    },
    render: (width) => {
      list ??= new SelectList(items(), 20, getSelectListTheme());
      return list.render(width);
    },
    handleInput: (data) => list?.handleInput(data),
  };
}

function infoPanelComponent(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  theme: Theme,
  tui: TUI,
  done: () => void,
): Component {
  let tab = 0;
  const bodies: Component[] = [
    listBody(() =>
      pi.getCommands().map((cmd) => ({
        value: cmd.name,
        label: `/${cmd.name}`,
        description: `[${cmd.source}] ${cmd.description || 'No description'}`,
      })),
    ),
    listBody(() =>
      pi.getAllTools().map((tool) => ({
        value: tool.name,
        label: tool.name,
        description: tool.description || 'No description',
      })),
    ),
    {
      invalidate: () => {},
      render: (width) => new Text(ctx.getSystemPrompt(), 1, 0).render(Math.max(1, width - 2)),
    },
  ];

  const body: Component = {
    invalidate: () => bodies.forEach((b) => b.invalidate?.()),
    render: (width) => bodies[tab].render(width),
    handleInput: (data) => bodies[tab].handleInput?.(data),
  };

  const container = new Container();
  container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));
  container.addChild(new Text(theme.fg('accent', theme.bold('Info')), 1, 0));
  container.addChild(new Spacer(1));

  const tabsRow: Component = {
    invalidate: () => {},
    render: () => {
      const parts = TABS.map((name, i) => theme.fg(i === tab ? 'accent' : 'muted', i === tab ? `[${name}]` : name));
      return [` ${parts.join('  ')}`];
    },
  };
  container.addChild(tabsRow);
  container.addChild(new Spacer(1));
  container.addChild(body);
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg('dim', '←→ tabs · Esc close'), 1, 0));
  container.addChild(new DynamicBorder((s: string) => theme.fg('accent', s)));

  return {
    render: (width) => container.render(width),
    invalidate: () => {
      container.invalidate();
      body.invalidate();
    },
    handleInput: (data) => {
      if (matchesKey(data, Key.escape)) {
        done();
        return;
      }
      if (matchesKey(data, Key.left)) tab = (tab + TABS.length - 1) % TABS.length;
      else if (matchesKey(data, Key.right)) tab = (tab + 1) % TABS.length;
      else {
        body.handleInput?.(data);
        tui.requestRender();
        return;
      }
      body.invalidate();
      tui.requestRender();
    },
  };
}

export async function openInfoPanel(ctx: ExtensionContext, pi: ExtensionAPI) {
  if (ctx.mode !== 'tui') return;
  await ctx.ui.custom(
    (tui, theme, _kb, done) => infoPanelComponent(pi, ctx, theme, tui, () => done(undefined)),
    {
      overlay: true,
      overlayOptions: {
        anchor: 'left-center',
        width: '35%',
        minWidth: 32,
        maxHeight: '90%',
        margin: 1,
      },
    },
  );
}
