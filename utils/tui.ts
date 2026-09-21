import { truncateToWidth, visibleWidth, type Component, type TUI } from '@earendil-works/pi-tui';

/** Layout grid for TUI extensions — spans map to a share of the terminal width. */
export const TUI_GRID_COLUMNS = 12;

export type GridSpan = number;
export type PanelSide = 'left' | 'right';

export type PiTui = TUI & {
  doRender?: (...args: unknown[]) => unknown;
  renderNow?: (force?: boolean) => void;
  getFocusedComponent: () => Component | null;
};

export type EditorLike = Component & { getCursor?: () => { line: number; col: number } };

export type ColsOrSpan = {
  /** Fixed width in terminal columns. */
  cols?: number;
  /** Width as a fraction of the terminal using {@link TUI_GRID_COLUMNS}. */
  span?: GridSpan;
};

export type PanelLayout = {
  rawCols: number;
  panelCols: number;
  separatorCols: number;
  mainPaddingCols: number;
  mainPaddingRightCols: number;
  reservedCols: number;
  sepCol: number;
  panelCol: number;
  mainStartCol: number;
  mainWidth: number;
  virtualCols: number;
};

export type PanelLayoutOptions = {
  side: PanelSide;
  panel: ColsOrSpan;
  separatorCols?: number;
  /** Gap between the panel separator and main content (left panel only). */
  mainPaddingCols?: number;
  /** Gap between main content and the terminal's right edge. */
  mainPaddingRightCols?: number;
  gridColumns?: number;
  defaultPanelCols?: number;
};

export const SYNC_OUTPUT_BEGIN = '\x1b[?2026h';
export const SYNC_OUTPUT_END = '\x1b[?2026l';
export const cursor = (row: number, col: number) => `\x1b[${row};${col}H`;

export function descriptorFor(obj: object, key: string): PropertyDescriptor | undefined {
  let target: object | null = obj;
  while (target) {
    const d = Object.getOwnPropertyDescriptor(target, key);
    if (d) return d;
    target = Object.getPrototypeOf(target);
  }
  return undefined;
}

export function rawTerminalColumns(
  terminal: { columns: number },
  columnsDesc?: PropertyDescriptor,
): number {
  const d = columnsDesc;
  const raw = d?.get ? d.get.call(terminal) : typeof d?.value === 'number' ? d.value : terminal.columns;
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(1, Math.floor(raw)) : 80;
}

/** Convert a grid span (of {@link TUI_GRID_COLUMNS}) to terminal columns. */
export function colsFromGridSpan(
  span: GridSpan,
  rawCols: number,
  gridColumns: number = TUI_GRID_COLUMNS,
): number {
  const units = Math.max(0, span);
  if (units === 0) return 1;
  return Math.max(1, Math.round((rawCols / gridColumns) * units));
}

/** Convert terminal columns to the nearest grid span. */
export function gridSpanFromCols(
  cols: number,
  rawCols: number,
  gridColumns: number = TUI_GRID_COLUMNS,
): GridSpan {
  return Math.max(1, Math.min(gridColumns, Math.round((cols / rawCols) * gridColumns)));
}

export function resolveCols(
  spec: ColsOrSpan,
  rawCols: number,
  gridColumns: number = TUI_GRID_COLUMNS,
  defaultCols = 1,
): number {
  if (spec.cols != null) return Math.max(1, spec.cols);
  if (spec.span != null) return colsFromGridSpan(spec.span, rawCols, gridColumns);
  return Math.max(1, defaultCols);
}

export function resolvePanelLayout(rawCols: number, options: PanelLayoutOptions): PanelLayout {
  const side = options.side;
  const gridColumns = options.gridColumns ?? TUI_GRID_COLUMNS;
  const separatorCols = options.separatorCols ?? 1;
  const mainPaddingCols = side === 'left' ? (options.mainPaddingCols ?? 0) : 0;
  const mainPaddingRightCols = options.mainPaddingRightCols ?? 0;
  const panelCols = resolveCols(
    options.panel,
    rawCols,
    gridColumns,
    options.defaultPanelCols ?? colsFromGridSpan(4, rawCols, gridColumns),
  );
  const reservedCols = panelCols + separatorCols + mainPaddingCols + mainPaddingRightCols;
  const sepCol = side === 'left' ? panelCols + 1 : rawCols - panelCols;
  const panelCol = side === 'left' ? 1 : sepCol + 1;
  const mainStartCol = side === 'left' ? panelCols + separatorCols + 1 + mainPaddingCols : 1;

  return {
    rawCols,
    panelCols,
    separatorCols,
    mainPaddingCols,
    mainPaddingRightCols,
    reservedCols,
    sepCol,
    panelCol,
    mainStartCol,
    mainWidth: Math.max(1, rawCols - reservedCols),
    virtualCols: Math.max(1, rawCols - reservedCols),
  };
}

export function padLine(line: string | undefined, width: number): string {
  const text = line ? truncateToWidth(line, width, '', true) : '';
  return `${text}${' '.repeat(Math.max(0, width - visibleWidth(text)))}`;
}

/** Shift pi-tui writes into a left-hand panel's main content area. */
export function sanitizeWriteLeft(data: string, mainWidth: number, mainStart: number): string {
  const goMain = `\x1b[${mainStart}G`;

  let out = data.replace(/\x1b\[\?2026[hl]/g, '');
  out = out.replace(/\x1b\[2K/g, `\x1b[${mainWidth}X`);
  out = out.replace(/\x1b\[((?:\d+);)?(\d*)H/g, (_, row, col) => {
    const r = row ?? '1';
    const c = col ? parseInt(col, 10) + mainStart - 1 : mainStart;
    return `\x1b[${r};${c}H`;
  });
  out = out.replace(/\x1b\[(\d+)G/g, (_, col) => `\x1b[${parseInt(col, 10) + mainStart - 1}G`);
  out = out.replace(/\r\n/g, `\r\n${goMain}`);
  out = out.replace(/\r/g, `\r${goMain}`);
  out = out.replace(/\n/g, `\n${goMain}`);

  return out;
}

/** Bound pi-tui line clears so they do not spill into a right-hand panel. */
export function sanitizeWriteRight(data: string, mainWidth: number): string {
  return data.replace(/\x1b\[\?2026[hl]/g, '').replace(/\x1b\[2K/g, `\x1b[${mainWidth}X`);
}

export function forceRender(tui: PiTui): void {
  tui.renderNow?.(true) ?? tui.requestRender(true);
}
