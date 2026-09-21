import { type ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
  isKeyRelease,
  isKeyRepeat,
  matchesKey,
  parseKey,
  truncateToWidth,
  wrapTextWithAnsi,
  type Component,
  type KeyId,
} from '@earendil-works/pi-tui';
import {
  colsFromGridSpan,
  cursor,
  padLine,
  rawTerminalColumns,
  type ColsOrSpan,
  type EditorLike,
  type GridSpan,
  type PanelSide,
  type PiTui,
  SYNC_OUTPUT_BEGIN,
  SYNC_OUTPUT_END,
} from './tui.ts';
import { createMainView, type MainViewHandle, type ViewPadding } from './view.ts';

export type SidebarItem = (width: number) => string[];
export type SidebarMenu = {
  label: string;
  items: SidebarItem[];
  hint?: string;
  handleInput?: (data: string) => boolean;
};
export type SidebarOptions = {
  /** Expanded panel width in terminal columns. */
  width?: number;
  /** Expanded panel width on the {@link TUI_GRID_COLUMNS} grid. */
  widthSpan?: GridSpan;
  /** Collapsed strip width in terminal columns. */
  collapsedWidth?: number;
  /** Collapsed strip width on the grid (`0` → 1 column). */
  collapsedSpan?: GridSpan;
  /** Main content padding. Passed to {@link createMainView}. */
  mainPadding?: ViewPadding | number;
  side?: PanelSide;
  placement?: 'aboveEditor' | 'belowEditor';
  chrome?: {
    tab?: (label: string, active: boolean, focused: boolean) => string;
    hint?: (text: string) => string;
    dim?: (text: string) => string;
  };
  onFocusChange?: (focused: boolean) => void;
  onClose?: () => void;
};
export type SidebarHandle = {
  close: () => void;
  paint: () => void;
  isOpen: () => boolean;
  focus: () => void;
  blur: () => void;
  isFocused: () => boolean;
  setMainPadding: (padding: ViewPadding) => void;
};

export function isSidebarKey(data: string, key: KeyId): boolean {
  if (isKeyRelease(data) || isKeyRepeat(data)) return false;
  const parsed = parseKey(data);
  return parsed === key || matchesKey(data, key);
}

export function item(lines: string[] | ((width: number) => string[])): SidebarItem {
  return typeof lines === 'function' ? lines : (width) => lines.map((line) => truncateToWidth(line, width, '', true));
}

export function wrapItem(text: string, width: number): string[] {
  return wrapTextWithAnsi(text, Math.max(1, width));
}

const noop = () => {};
const emptyHandle: SidebarHandle = {
  close: noop,
  paint: noop,
  isOpen: () => false,
  focus: noop,
  blur: noop,
  isFocused: () => false,
  setMainPadding: noop,
};

function stackItems(items: SidebarItem[], width: number): string[] {
  const w = Math.max(1, width);
  return items
    .map((item) => item(w).map((line) => truncateToWidth(line, w, '', true)))
    .filter((lines) => lines.length)
    .reduce<string[]>((out, lines, i) => (i ? out.push('') : 0, out.push(...lines), out), []);
}

function renderContent(
  menus: SidebarMenu[],
  tab: number,
  width: number,
  focused: boolean,
  chrome: SidebarOptions['chrome'] = {},
): string[] {
  if (!menus.length || !focused) return [];
  const w = Math.max(1, width);
  const active = Math.max(0, Math.min(tab, menus.length - 1));
  const paintTab = chrome.tab ?? ((label, on) => (on ? `[${label}]` : label));
  const dim = chrome.dim ?? ((text) => text);
  const body = stackItems(menus[active].items, w);
  return [
    truncateToWidth(` ${menus.map((m, i) => paintTab(m.label, i === active, focused)).join('  ')}`, w, '', true),
    '',
    ...(focused ? body : body.map((line) => dim(line))),
  ];
}

function renderFooter(
  menus: SidebarMenu[],
  tab: number,
  width: number,
  focused: boolean,
  chrome: SidebarOptions['chrome'] = {},
): string[] {
  if (!menus.length || !focused) return [];
  const w = Math.max(1, width);
  const active = Math.max(0, Math.min(tab, menus.length - 1));
  const paintHint = chrome.hint ?? ((text) => text);
  const lines: string[] = [];

  const menuHint = menus[active].hint;
  if (menuHint) lines.push(truncateToWidth(paintHint(menuHint), w, '', true));
  if (active === menus.length - 1) lines.push(truncateToWidth(paintHint(' → back to input'), w, '', true));
  else lines.push(truncateToWidth(paintHint(' ←→ tabs'), w, '', true));
  lines.push(truncateToWidth(paintHint(' esc back to input'), w, '', true));
  return lines;
}

function resolvePanelWidth(rawCols: number, spec: ColsOrSpan, gridDefaultSpan: GridSpan): number {
  if (spec.cols != null) return Math.max(1, spec.cols);
  if (spec.span != null) return colsFromGridSpan(spec.span, rawCols);
  return colsFromGridSpan(gridDefaultSpan, rawCols);
}

function resolveMainPadding(value: SidebarOptions['mainPadding']): ViewPadding {
  if (typeof value === 'number') return { left: value, right: value };
  return { left: value?.left ?? 2, right: value?.right ?? value?.left ?? 2 };
}

class SidebarCompositor {
  private disposed = false;
  private view: MainViewHandle | null = null;
  private sidebarExpanded = false;
  private expandedPanel: ColsOrSpan;
  private collapsedPanel: ColsOrSpan;

  constructor(
    private tui: PiTui,
    private getLayout: () => { content: string[]; footer: string[]; focused: boolean },
    expandedPanel: ColsOrSpan,
    collapsedPanel: ColsOrSpan,
    private side: PanelSide,
    private mainPadding: ViewPadding,
  ) {
    this.expandedPanel = expandedPanel;
    this.collapsedPanel = collapsedPanel;
  }

  setExpanded(expanded: boolean): boolean {
    this.sidebarExpanded = expanded;
    const rawCols = this.view?.rawColumns() ?? 80;
    const spec = expanded ? this.expandedPanel : this.collapsedPanel;
    return this.view?.setPanelCols(resolvePanelWidth(rawCols, spec, expanded ? 4 : 0)) ?? false;
  }

  setMainPadding(padding: ViewPadding): boolean {
    return this.view?.setPadding(padding) ?? false;
  }

  expandedPanelCols(): number {
    const rawCols = this.view?.rawColumns() ?? 80;
    return resolvePanelWidth(rawCols, this.expandedPanel, 4);
  }

  install(): void {
    const rawCols = rawTerminalColumns(this.tui.terminal);
    const initialCols = resolvePanelWidth(rawCols, this.collapsedPanel, 0);
    this.view = createMainView(this.tui, initialCols, {
      side: this.side,
      padding: this.mainPadding,
    });
    this.view.wrapRenderer(() => {
      if (!this.disposed) this.paint(false);
    });
  }

  paint(standalone = true): void {
    if (this.disposed || !this.view) return;

    const terminal = this.tui.terminal;
    const rows = terminal.rows;
    const { panelCols, sepCol, panelCol } = this.view.layout();
    const { content, footer, focused } = this.getLayout();
    const footerStart = rows - footer.length;
    const sep = focused ? '\x1b[1m│\x1b[22m' : '\x1b[2m│\x1b[22m';
    const strip = ' '.repeat(panelCols);

    this.view.withWriteHookSkipped(() => {
      let buf = standalone ? SYNC_OUTPUT_BEGIN : '';
      buf += '\x1b7\x1b[?7l';
      for (let i = 0; i < rows; i++) {
        const row = i + 1;
        let line: string | undefined;
        if (focused && footer.length && i >= footerStart) line = footer[i - footerStart];
        else if (focused && i < content.length) line = content[i];
        buf += cursor(row, sepCol);
        buf += sep;
        buf += cursor(row, panelCol);
        buf += focused ? padLine(line, panelCols) : strip;
      }
      buf += '\x1b[?7h\x1b8';
      if (standalone) buf += SYNC_OUTPUT_END;
      terminal.write(buf);
    });
  }

  refresh(): void {
    this.view?.refresh();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.view?.dispose();
    this.view = null;
  }
}

export function mountSidebar(
  ctx: ExtensionContext,
  id: string,
  getMenus: () => SidebarMenu[],
  options: SidebarOptions = {},
): Promise<SidebarHandle> {
  if (ctx.mode !== 'tui' || !ctx.hasUI) return Promise.resolve(emptyHandle);

  const expandedPanel: ColsOrSpan = {
    cols: options.width,
    span: options.widthSpan ?? 4,
  };
  const collapsedPanel: ColsOrSpan = {
    cols: options.collapsedWidth,
    span: options.collapsedSpan ?? 0,
  };
  const mainPadding = resolveMainPadding(options.mainPadding);
  const side = options.side ?? 'left';
  let compositor: SidebarCompositor | null = null;
  let tuiRef: PiTui | null = null;
  let editorRef: Component | null = null;
  let tab = 0;
  let focused = false;
  let mounted = false;
  let unsubInput: (() => void) | null = null;

  const lastTab = () => Math.max(0, getMenus().length - 1);

  const layout = () => {
    const menus = getMenus();
    const width = compositor?.expandedPanelCols() ?? resolvePanelWidth(80, expandedPanel, 4);
    return {
      content: renderContent(menus, tab, width, focused, options.chrome),
      footer: renderFooter(menus, tab, width, focused, options.chrome),
      focused,
    };
  };

  const syncLayout = () => {
    compositor?.setExpanded(focused);
    compositor?.refresh();
  };

  const setMainPadding = (padding: ViewPadding) => {
    if (compositor?.setMainPadding(padding)) syncLayout();
  };

  const repaint = () => syncLayout();

  const blur = () => {
    if (!focused) return;
    focused = false;
    if (editorRef) tuiRef?.setFocus(editorRef);
    editorRef = null;
    options.onFocusChange?.(false);
    syncLayout();
  };

  const focus = () => {
    if (focused || !mounted) return;
    editorRef = tuiRef?.getFocusedComponent() ?? editorRef;
    tab = lastTab();
    focused = true;
    tuiRef?.setFocus(null);
    options.onFocusChange?.(true);
    syncLayout();
  };

  const canEnterFromEditor = (data: string) => {
    if (isKeyRelease(data) || isKeyRepeat(data)) return false;
    const key = parseKey(data);
    if (key !== 'left') return false;
    const editor = tuiRef?.getFocusedComponent() as EditorLike | null;
    const pos = editor?.getCursor?.();
    return !!pos && pos.line === 0 && pos.col === 0;
  };

  const close = () => {
    if (!mounted) return;
    blur();
    unsubInput?.();
    unsubInput = null;
    mounted = false;
    ctx.ui.setWidget(id, undefined);
    compositor?.dispose();
    compositor = null;
    tuiRef = null;
    editorRef = null;
    options.onClose?.();
  };

  const onInput = (data: string) => {
    if (!mounted) return;

    if (!focused) {
      if (!canEnterFromEditor(data)) return;
      return focus(), { consume: true };
    }

    if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
    const key = parseKey(data);
    if (!key) return { consume: true };

    const menus = getMenus();
    if (!menus.length) return { consume: true };
    if (key === 'escape' || key === 'esc') return blur(), { consume: true };

    if (key === 'right') {
      if (tab === menus.length - 1) return blur(), { consume: true };
      tab = (tab + 1) % menus.length;
      return repaint(), { consume: true };
    }

    if (key === 'left') return (tab = (tab + menus.length - 1) % menus.length), repaint(), { consume: true };
    if (menus[tab].handleInput?.(data)) return repaint(), { consume: true };
    return { consume: true };
  };

  ctx.ui.setWidget(
    id,
    (tui) => {
      tuiRef = tui as PiTui;
      tab = lastTab();
      focused = false;
      editorRef = null;
      compositor = new SidebarCompositor(tuiRef, layout, expandedPanel, collapsedPanel, side, mainPadding);
      compositor.install();
      compositor.setExpanded(false);
      mounted = true;
      unsubInput = ctx.ui.onTerminalInput(onInput);
      syncLayout();
      return { dispose: close, invalidate: noop, render: () => [] };
    },
    { placement: options.placement ?? 'belowEditor' },
  );

  return Promise.resolve({
    close,
    paint: repaint,
    isOpen: () => mounted,
    focus,
    blur,
    isFocused: () => focused,
    setMainPadding,
  });
}

export { TUI_GRID_COLUMNS } from './tui.ts';
export type { ViewPadding } from './view.ts';
