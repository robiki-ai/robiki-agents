import {
  descriptorFor,
  forceRender,
  rawTerminalColumns,
  resolvePanelLayout,
  sanitizeWriteLeft,
  sanitizeWriteRight,
  SYNC_OUTPUT_BEGIN,
  SYNC_OUTPUT_END,
  type PanelLayout,
  type PanelSide,
  type PiTui,
} from './tui.ts';

export type ViewPadding = {
  /** Gap between a left-hand panel separator and main content. */
  left?: number;
  /** Gap between main content and the terminal's right edge. Defaults to {@link left}. */
  right?: number;
};

export type MainViewOptions = {
  side: PanelSide;
  padding?: ViewPadding;
};

export type MainViewHandle = {
  rawColumns: () => number;
  layout: () => PanelLayout;
  panelCols: () => number;
  setPanelCols: (cols: number) => boolean;
  setPadding: (padding: ViewPadding) => boolean;
  padding: () => Required<ViewPadding>;
  withWriteHookSkipped: <T>(fn: () => T) => T;
  wrapRenderer: (afterRender: () => void) => void;
  refresh: () => void;
  dispose: () => void;
};

/** Reserve terminal columns for a side panel and render pi's UI in the remaining main area. */
export function createMainView(
  tui: PiTui,
  initialPanelCols: number,
  options: MainViewOptions,
): MainViewHandle {
  const terminal = tui.terminal;
  const side = options.side;
  const columnsDesc = descriptorFor(terminal, 'columns');
  const columnsOwnDesc = Object.getOwnPropertyDescriptor(terminal, 'columns');
  const baseWrite = terminal.write.bind(terminal);
  let activePanelCols = Math.max(1, initialPanelCols);
  let paddingLeft = Math.max(0, options.padding?.left ?? 0);
  let paddingRight = Math.max(0, options.padding?.right ?? options.padding?.left ?? 0);
  let skipWriteHook = false;
  let afterRender: (() => void) | undefined;
  let originalDoRender: ((...args: unknown[]) => unknown) | undefined;

  const layoutOptions = () => ({
    side,
    mainPaddingCols: side === 'left' ? paddingLeft : 0,
    mainPaddingRightCols: paddingRight,
  });

  const layout = () =>
    resolvePanelLayout(rawTerminalColumns(terminal, columnsDesc), {
      ...layoutOptions(),
      panel: { cols: activePanelCols },
    });

  const sanitize = (data: string) => {
    const { mainWidth, mainStartCol } = layout();
    return side === 'left' ? sanitizeWriteLeft(data, mainWidth, mainStartCol) : sanitizeWriteRight(data, mainWidth);
  };

  Object.defineProperty(terminal, 'columns', {
    configurable: true,
    enumerable: true,
    get() {
      return layout().virtualCols;
    },
  });

  const wrapRenderer = (cb: () => void) => {
    afterRender = cb;
    if (originalDoRender) return;

    const target = tui as PiTui & { doRender?: (...args: unknown[]) => unknown };
    const orig = target.doRender;
    if (!orig) return;

    originalDoRender = orig;
    target.doRender = function (this: unknown, ...args: unknown[]) {
      baseWrite(SYNC_OUTPUT_BEGIN);
      const writeOwnDesc = Object.getOwnPropertyDescriptor(terminal, 'write');
      const prevWrite = terminal.write.bind(terminal);
      let result: unknown;
      let thrown: unknown;

      try {
        Object.defineProperty(terminal, 'write', {
          configurable: true,
          enumerable: true,
          writable: true,
          value(this: unknown, data: string) {
            if (typeof data !== 'string') return prevWrite.call(this, data as never);
            if (skipWriteHook) return prevWrite.call(this, data);
            return prevWrite.call(this, sanitize(data));
          },
        });

        try {
          result = originalDoRender!.apply(this, args);
        } catch (error) {
          thrown = error;
        }

        if (thrown === undefined) {
          try {
            afterRender?.();
          } catch {
            // Panel painting must never break pi's render cycle.
          }
        }
      } finally {
        if (writeOwnDesc) Object.defineProperty(terminal, 'write', writeOwnDesc);
        else Reflect.set(terminal, 'write', prevWrite);
        baseWrite(SYNC_OUTPUT_END);
      }

      if (thrown !== undefined) throw thrown;
      return result;
    };
  };

  return {
    rawColumns: () => rawTerminalColumns(terminal, columnsDesc),
    layout,
    panelCols: () => activePanelCols,
    setPanelCols(cols: number) {
      const next = Math.max(1, cols);
      const changed = next !== activePanelCols;
      activePanelCols = next;
      return changed;
    },
    setPadding(padding: ViewPadding) {
      const nextLeft = Math.max(0, padding.left ?? paddingLeft);
      const nextRight = Math.max(0, padding.right ?? padding.left ?? paddingRight);
      const changed = nextLeft !== paddingLeft || nextRight !== paddingRight;
      paddingLeft = nextLeft;
      paddingRight = nextRight;
      return changed;
    },
    padding: () => ({ left: paddingLeft, right: paddingRight }),
    withWriteHookSkipped<T>(fn: () => T): T {
      skipWriteHook = true;
      try {
        return fn();
      } finally {
        skipWriteHook = false;
      }
    },
    wrapRenderer,
    refresh: () => forceRender(tui),
    dispose: () => {
      const target = tui as PiTui & { doRender?: (...args: unknown[]) => unknown };
      if (originalDoRender) target.doRender = originalDoRender;
      if (columnsOwnDesc) Object.defineProperty(terminal, 'columns', columnsOwnDesc);
      else Reflect.deleteProperty(terminal, 'columns');
    },
  };
}
