import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluateSceneGraphExportSafety } from "./export-safety.ts";
import { decodeSceneGraphFromText } from "./scene-graph-codec.ts";
import { type SceneGraph } from "./types.ts";
import { evaluatePageContentCoverage } from "./workflow.ts";

const validGraph = JSON.parse(
  readFileSync("input/llm-direct-lowlevel-smoke-mock/page-001.json", "utf8"),
) as SceneGraph;

assert.equal(decodeSceneGraphFromText(JSON.stringify(validGraph), false).graph.slide.elements.length, 17);
const singleton = decodeSceneGraphFromText(JSON.stringify({ slides: [validGraph] }), false);
assert.equal(singleton.graph.slide.elements.length, 17);
assert(singleton.normalizationChanges.includes("unwrapped singleton slides response"));

assert.throws(
  () => decodeSceneGraphFromText(JSON.stringify({ slides: [validGraph, validGraph, validGraph, validGraph] }), false),
  /expected exactly one slide, but received 4/,
);
assert.throws(() => decodeSceneGraphFromText(JSON.stringify({ version: "scene-graph/v1" }), false), /root\.slide is required/);
assert.throws(
  () => decodeSceneGraphFromText(JSON.stringify({ ...validGraph, slide: { ...validGraph.slide, elements: [] } }), false),
  /slide\.elements cannot be empty/,
);

assert.equal(evaluateSceneGraphExportSafety(validGraph).ok, true);
const emptyGraph = { ...validGraph, slide: { ...validGraph.slide, elements: [] } } as SceneGraph;
const emptySafety = evaluateSceneGraphExportSafety(emptyGraph);
assert.equal(emptySafety.ok, false);
assert.match(emptySafety.reason ?? "", /no elements/);

const completeCoverage = evaluatePageContentCoverage(
  "页标题：增长引擎从获客转向留存\n2026年重点转向核心用户",
  validGraph,
);
assert.equal(completeCoverage.ok, true);

const incompleteCoverage = evaluatePageContentCoverage(
  "页标题：增长引擎从获客转向留存\n2026年重点转向核心用户，目标提升35%",
  validGraph,
);
assert.equal(incompleteCoverage.ok, false);
assert.deepEqual(incompleteCoverage.missingAnchors, ["35%"]);

console.log("SCENE_GRAPH_QUALITY_SMOKE_OK");
