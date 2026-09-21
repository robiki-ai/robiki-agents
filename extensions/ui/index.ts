import {
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Key } from '@earendil-works/pi-tui';
import { isSidebarKey, item, mountSidebar, wrapItem, type SidebarHandle, type SidebarMenu } from '../../utils/sidebar.ts';

const SIDEBAR_ID = 'ui-sidebar';

type Todo = { text: string; done: boolean };

export default function (pi: ExtensionAPI) {
  let sessionCtx: ExtensionContext | null = null;
  let sidebar: SidebarHandle | null = null;
  let activeTheme = '';
  let todoIndex = 0;
  let themeIndex = 0;
  let todos: Todo[] = [
    { text: 'Press ← at start of input to focus sidebar', done: false },
    { text: 'Switch to Themes tab with →', done: false },
    { text: 'Try a different theme', done: false },
  ];

  function menus(): SidebarMenu[] {
    const ctx = sessionCtx;
    if (!ctx?.hasUI) return [];

    const theme = ctx.ui.theme;
    const themes = ctx.ui.getAllThemes();
    if (!activeTheme) activeTheme = (theme as { name?: string }).name ?? themes[0]?.name ?? '';

    return [
      {
        label: 'Todos',
        hint: '↑↓ select · space toggle',
        items: [
          item((w) => [theme.fg('accent', theme.bold('Todo List'.padEnd(w)))]),
          item((w) =>
            todos.flatMap((todo, i) => {
              const marker = todo.done ? '✓' : '○';
              const color = i === todoIndex ? 'accent' : todo.done ? 'success' : 'muted';
              const prefix = i === todoIndex ? '▸ ' : '  ';
              return wrapItem(theme.fg(color, `${prefix}${marker} ${todo.text}`), w);
            }),
          ),
        ],
        handleInput: (data) => {
          if (isSidebarKey(data, Key.up)) return (todoIndex = Math.max(0, todoIndex - 1)), true;
          if (isSidebarKey(data, Key.down)) return (todoIndex = Math.min(todos.length - 1, todoIndex + 1)), true;
          if (isSidebarKey(data, Key.space)) return (todos[todoIndex].done = !todos[todoIndex].done), true;
          return false;
        },
      },
      {
        label: 'Themes',
        hint: '↑↓ select · enter apply',
        items: [
          item((w) => [theme.fg('accent', theme.bold('Themes'.padEnd(w)))]),
          item(() =>
            themes.map(({ name }, i) => {
              const active = name === activeTheme;
              const color = i === themeIndex ? 'accent' : active ? 'success' : 'dim';
              const cursor = i === themeIndex ? '▸' : ' ';
              const mark = active ? ' ●' : '';
              return theme.fg(color, `${cursor} ${name}${mark}`);
            }),
          ),
        ],
        handleInput: (data) => {
          if (isSidebarKey(data, Key.up)) return (themeIndex = Math.max(0, themeIndex - 1)), true;
          if (isSidebarKey(data, Key.down)) return (themeIndex = Math.min(themes.length - 1, themeIndex + 1)), true;
          if (!isSidebarKey(data, Key.enter)) return false;
          const name = themes[themeIndex]?.name;
          if (!name) return true;
          const result = ctx.ui.setTheme(name);
          if (!result.success) return ctx.ui.notify(result.error ?? 'Failed to set theme', 'error'), true;
          activeTheme = name;
          return true;
        },
      },
    ];
  }

  function sidebarOptions(ctx: ExtensionCommandContext | ExtensionContext) {
    const theme = ctx.ui.theme;
    return {
      widthSpan: 4,
      collapsedSpan: 0,
      mainPadding: 2,
      side: 'left' as const,
      chrome: {
        tab: (label: string, active: boolean, focused: boolean) =>
          theme.fg(focused ? (active ? 'accent' : 'muted') : 'dim', active ? `[${label}]` : label),
        hint: (text: string) => theme.fg('dim', text),
        dim: (text: string) => theme.fg('dim', text),
      },
      onClose: () => {
        sidebar = null;
      },
    };
  }

  function ensureSidebar(ctx: ExtensionCommandContext | ExtensionContext) {
    if (sidebar?.isOpen()) return sidebar.paint(), Promise.resolve(sidebar);
    return mountSidebar(ctx, SIDEBAR_ID, menus, sidebarOptions(ctx)).then((handle) => {
      sidebar = handle;
      return handle;
    });
  }

  pi.on('session_start', (_event, ctx) => {
    sessionCtx = ctx;
    const themes = ctx.ui.getAllThemes();
    activeTheme = (ctx.ui.theme as { name?: string }).name ?? themes[0]?.name ?? '';
    themeIndex = Math.max(0, themes.findIndex(({ name }) => name === activeTheme));
    ensureSidebar(ctx);
  });

  pi.on('session_shutdown', () => {
    sidebar?.close();
    sidebar = null;
    sessionCtx = null;
    activeTheme = '';
    todoIndex = 0;
    themeIndex = 0;
  });

  pi.registerCommand('sidebar', {
    description: 'UI sidebar: focus | blur | toggle-focus',
    handler: (args, ctx) =>
      ensureSidebar(ctx).then((handle) => {
        const cmd = args?.trim() || 'toggle-focus';
        if (cmd === 'focus') return handle.focus();
        if (cmd === 'blur') return handle.blur();
        return handle.isFocused() ? handle.blur() : handle.focus();
      }),
  });
}
