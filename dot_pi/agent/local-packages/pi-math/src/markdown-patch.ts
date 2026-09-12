import {
  Markdown,
  allocateImageId,
  getCapabilities,
  getCellDimensions,
  type DefaultTextStyle,
} from "@earendil-works/pi-tui";
import { insertFormulaImages, type FormulaImagePlacement } from "./image-layout.js";
import type { TerminalMathRenderer } from "./renderer.js";
import { resolveFormulaColor } from "./text-color.js";
import {
  containsPotentialMath,
  expandMathInMarkdown,
  stripGeneratedMathFenceLines,
} from "./transform.js";

const MAX_RASTER_HEIGHT_PX = 4096;

type MarkdownInternals = {
  text: string;
  paddingX?: number;
  defaultTextStyle?: DefaultTextStyle;
};

type MarkdownRender = (this: Markdown, width: number) => string[];

interface CachedTransform {
  source: string;
  layoutKey: string;
  transformed: string;
  placements: FormulaImagePlacement[];
}

// Pi recreates Markdown instances for every streamed delta. Keep completed formula IDs
// stable across append-only replacements so unchanged lines stay byte-identical to the TUI.
interface TransformLineage {
  imageIds: Map<string, number>;
  layoutKey: string;
  lastUsed: number;
  source: string;
}

const MAX_TRANSFORM_LINEAGES = 32;
const PATCH_STATE_KEY = Symbol.for("pi-math.markdown.patch");

type MarkdownPrototype = {
  render: MarkdownRender;
  [key: symbol]: unknown;
};

interface SharedPatchState {
  wrapper: MarkdownRender;
  baseRender: MarkdownRender;
  delegate: MarkdownRender;
  renderer: TerminalMathRenderer;
  enabled: boolean;
  installed: boolean;
  owner: symbol;
  transformCache: WeakMap<Markdown, CachedTransform>;
  transformLineages: TransformLineage[];
  lineageUsage: number;
}

export interface MathPatchController {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  clearTransformCache(): void;
  /**
   * Re-assert the wrapper only when the prototype still exposes the delegate
   * captured by this patch. Never adopt an arbitrary current wrapper: another
   * extension may already delegate to pi-math, and adopting it would create a
   * render cycle during reloads or mid-session patches.
   */
  rearm(): void;
  uninstall(): void;
}

function formulaColor(markdown: MarkdownInternals): string {
  return resolveFormulaColor({ sampleStyle: markdown.defaultTextStyle?.color });
}

function imageMarker(
  imageId: number,
  index: number,
  columns: number,
  inline: boolean,
): string {
  if (!inline) return `__PI_MATH_IMAGE_${imageId}_${index}__`;
  const privateUseCharacter = String.fromCodePoint(0xe000 + (index % 0x1900));
  return privateUseCharacter.repeat(columns);
}

function allocateMathImageId(): number {
  return (allocateImageId() & 0xffffff) || 1;
}

function formulaIdentity(
  latex: string,
  display: boolean,
  context: { start: number; end: number },
): string {
  return JSON.stringify([context.start, context.end, display, latex]);
}

function matchingLineage(
  lineages: TransformLineage[],
  source: string,
  layoutKey: string,
): TransformLineage | undefined {
  let match: TransformLineage | undefined;
  for (const candidate of lineages) {
    if (candidate.layoutKey !== layoutKey || !source.startsWith(candidate.source)) continue;
    if (!match || candidate.source.length > match.source.length) match = candidate;
  }
  return match;
}

/**
 * Build a controller for the shared patch state. The owner token makes old
 * extension instances harmless after `/reload`: a stale shutdown or turn hook
 * cannot tear down the wrapper adopted by a newer instance.
 */
function createPatchController(
  prototype: MarkdownPrototype,
  state: SharedPatchState,
  owner: symbol,
): MathPatchController {
  const ownsState = () => state.installed && state.owner === owner;

  return {
    isEnabled: () => ownsState() && state.enabled,
    setEnabled(value: boolean) {
      if (ownsState()) state.enabled = value;
    },
    clearTransformCache() {
      if (!ownsState()) return;
      state.transformCache = new WeakMap();
      state.transformLineages = [];
      state.lineageUsage = 0;
    },
    rearm() {
      if (!ownsState()) return;
      const current = prototype.render;
      if (current === state.wrapper) return;

      // Do not adopt an arbitrary current renderer. A wholesale patch may have
      // captured pi-math before replacing the prototype; adopting that wrapper
      // here would create an A -> B -> A cycle. Leave the other renderer in
      // control until it yields the delegate we originally captured.
      if (current !== state.baseRender && current !== state.delegate) return;

      state.delegate = current;
      prototype.render = state.wrapper;
    },
    uninstall() {
      if (!ownsState()) return;
      state.enabled = false;
      state.transformCache = new WeakMap();
      state.transformLineages = [];
      state.lineageUsage = 0;
      if (prototype.render === state.wrapper) prototype.render = state.delegate;
      state.installed = false;
      if (prototype[PATCH_STATE_KEY] === state) delete prototype[PATCH_STATE_KEY];
    },
  };
}

/**
 * Install a reversible display-only wrapper around Pi's Markdown renderer.
 * The source Markdown is restored before render() returns, so session history
 * and provider context always retain the original LaTeX.
 *
 * The state is stored with Symbol.for() on Markdown.prototype so duplicate
 * package instances share one wrapper instead of building a cross-instance
 * delegation cycle during reloads.
 */
export function installMarkdownMathPatch(renderer: TerminalMathRenderer): MathPatchController {
  const prototype = Markdown.prototype as unknown as MarkdownPrototype;
  const existing = prototype[PATCH_STATE_KEY] as SharedPatchState | undefined;
  const owner = Symbol("pi-math-owner");

  if (existing?.installed) {
    existing.renderer = renderer;
    existing.enabled = true;
    existing.owner = owner;
    return createPatchController(prototype, existing, owner);
  }

  const baseRender = prototype.render;
  let state: SharedPatchState;
  const patchedRender: MarkdownRender = function (width: number): string[] {
    const markdown = this as unknown as MarkdownInternals;
    const source = markdown.text;
    const protocol = getCapabilities().images;
    // Pi marks its transient reasoning component with a whole-block italic style.
    // Rasterizing it on every token floods Kitty and leaves no durable output to preserve.
    const isTransientReasoning = markdown.defaultTextStyle?.italic === true;
    if (
      !state.enabled ||
      !protocol ||
      typeof source !== "string" ||
      isTransientReasoning ||
      !containsPotentialMath(source)
    ) {
      return state.delegate.call(this, width);
    }

    const paddingX =
      typeof markdown.paddingX === "number" && Number.isFinite(markdown.paddingX)
        ? Math.max(0, markdown.paddingX)
        : 0;
    const color = formulaColor(markdown);
    const cells = getCellDimensions();
    const contentWidth = Math.max(1, width - paddingX * 2);
    const layoutKey = `${width}:${paddingX}:${color}:${protocol}:${cells.widthPx}:${cells.heightPx}`;
    const maxBlockRows = Math.max(1, Math.floor(MAX_RASTER_HEIGHT_PX / cells.heightPx));

    let transformed: string;
    let placements: FormulaImagePlacement[];
    const cached = state.transformCache.get(this);
    if (cached?.source === source && cached.layoutKey === layoutKey) {
      ({ transformed, placements } = cached);
    } else {
      placements = [];
      const lineage = matchingLineage(state.transformLineages, source, layoutKey);
      const imageIds = new Map<string, number>();
      transformed = expandMathInMarkdown(source, (latex, display, context) => {
        const inline = !display && !context.standalone;
        if (inline) return undefined;

        const raster = state.renderer.render(latex, display, color, {
          maxWidthCells: contentWidth,
          maxHeightCells: inline ? 1 : maxBlockRows,
          cellWidthPx: cells.widthPx,
          cellHeightPx: cells.heightPx,
          fitHeight: inline,
        });
        if (!raster) return undefined;

        const identity = formulaIdentity(latex, display, context);
        const imageId = lineage?.imageIds.get(identity) ?? allocateMathImageId();
        imageIds.set(identity, imageId);
        const marker = imageMarker(imageId, placements.length, raster.columns, inline);
        placements.push({
          marker,
          imageId,
          raster,
          inline,
          fallbackText: source.slice(context.start, context.end),
        });
        return { text: marker, forceBlock: !inline, rawInline: inline };
      });
      if (imageIds.size > 0) {
        const nextUsage = ++state.lineageUsage;
        if (lineage) {
          lineage.imageIds = imageIds;
          lineage.lastUsed = nextUsage;
          lineage.source = source;
        } else {
          state.transformLineages.push({ imageIds, layoutKey, lastUsed: nextUsage, source });
        }
        if (state.transformLineages.length > MAX_TRANSFORM_LINEAGES) {
          state.transformLineages.sort((left, right) => right.lastUsed - left.lastUsed);
          state.transformLineages = state.transformLineages.slice(0, MAX_TRANSFORM_LINEAGES);
        }
      }
      state.transformCache.set(this, { source, layoutKey, transformed, placements });
    }

    if (transformed === source || placements.length === 0) {
      return state.delegate.call(this, width);
    }

    markdown.text = transformed;
    try {
      const textLines = stripGeneratedMathFenceLines(state.delegate.call(this, width));
      return insertFormulaImages(textLines, placements, { renderWidth: width, paddingX });
    } finally {
      markdown.text = source;
    }
  };

  state = {
    wrapper: patchedRender,
    baseRender,
    delegate: baseRender,
    renderer,
    enabled: true,
    installed: true,
    owner,
    transformCache: new WeakMap(),
    transformLineages: [],
    lineageUsage: 0,
  };
  prototype[PATCH_STATE_KEY] = state;
  prototype.render = patchedRender;
  return createPatchController(prototype, state, owner);
}
