import { applyAutoLayout } from "./layout.ts";
import { parseJsonWithRepair, type JsonParseResult } from "./json-repair.ts";
import { normalizeSceneGraphInput, summarizeNormalizationChanges } from "./normalize.ts";
import { type CanvasPreset, type SceneGraph } from "./types.ts";
import { validateSceneGraph } from "./validate.ts";

export type SceneGraphDecodeResult = {
  graph: SceneGraph;
  jsonRepaired: boolean;
  jsonRepairNotes: string[];
  normalizationChanges: string[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapAndValidateEnvelope(value: unknown): { value: unknown; changes: string[] } {
  let candidate = value;
  const changes: string[] = [];

  if (isObject(candidate) && "slides" in candidate) {
    if (!Array.isArray(candidate.slides)) {
      throw new Error("Scene-graph response invalid: slides must be an array.");
    }
    if (candidate.slides.length !== 1) {
      throw new Error(`Scene-graph response invalid: expected exactly one slide, but received ${candidate.slides.length}.`);
    }
    candidate = candidate.slides[0];
    changes.push("unwrapped singleton slides response");
  }

  if (!isObject(candidate) || !isObject(candidate.slide)) {
    throw new Error("Scene-graph response invalid: root.slide is required.");
  }
  if (!Array.isArray(candidate.slide.elements)) {
    throw new Error("Scene-graph response invalid: slide.elements must be an array.");
  }
  if (candidate.slide.elements.length === 0) {
    throw new Error("Scene-graph response invalid: slide.elements cannot be empty.");
  }

  return { value: candidate, changes };
}

function decodeSceneGraphValue(
  parsed: JsonParseResult,
  applyLayout: boolean,
  options: { canvasPreset?: CanvasPreset } = {},
): SceneGraphDecodeResult {
  const envelope = unwrapAndValidateEnvelope(parsed.value);
  const normalizationChanges = [
    ...envelope.changes,
    ...summarizeNormalizationChanges(envelope.value),
  ];
  const normalizedValue = normalizeSceneGraphInput(envelope.value, options.canvasPreset);
  const validatedGraph = validateSceneGraph(normalizedValue);
  const graph = applyLayout ? applyAutoLayout(validatedGraph) : validatedGraph;

  if (applyLayout) {
    validateSceneGraph(graph);
  }

  return {
    graph,
    jsonRepaired: parsed.repaired,
    jsonRepairNotes: parsed.repairNotes,
    normalizationChanges,
  };
}

export function decodeSceneGraphFromText(input: string, applyLayout = true, options: { canvasPreset?: CanvasPreset } = {}): SceneGraphDecodeResult {
  return decodeSceneGraphValue(parseJsonWithRepair(input), applyLayout, options);
}

export function decodeSceneGraphFromParsedValue(value: unknown, applyLayout = true, options: { canvasPreset?: CanvasPreset } = {}): SceneGraphDecodeResult {
  return decodeSceneGraphValue({ value, repaired: false, repairNotes: [] }, applyLayout, options);
}
