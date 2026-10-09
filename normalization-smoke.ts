import { strict as assert } from "node:assert";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { decodeSceneGraphFromText } from "./scene-graph-codec.ts";

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectStrings(item));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap((item) => collectStrings(item));
  }
  return [];
}

function graphText(graph: unknown): string {
  return collectStrings(graph).join("\n");
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

const inlineRaw = JSON.stringify({
  version: "scene-graph/v1",
  slide: {
    id: "slide-001",
    width: 1280,
    height: 720,
    background: { type: "solid", color: "#FFFFFF" },
    theme: { fontFamily: "Noto Sans SC" },
    elements: [
      {
        id: "title",
        type: "title",
        role: "mainTitle",
        x: 48,
        y: 40,
        w: 760,
        h: 80,
        zIndex: 10,
        style: { fontSize: 34, fontWeight: "bold", color: "#172033" },
        content: "数字金融：筑基数字底座，赋能开放新格局",
      },
      {
        id: "body",
        type: "text",
        role: "body",
        x: 48,
        y: 140,
        w: 560,
        h: 120,
        zIndex: 20,
        style: { fontSize: 18, fontWeight: "700", fill: "#FFF7F2", stroke: "#E5E7EB", strokeWidth: 2, radius: 16 },
        content: "深耕国家级金融基础设施建设",
      },
      {
        id: "bullets",
        type: "bulletList",
        role: "facts",
        x: 48,
        y: 300,
        w: 500,
        h: 140,
        zIndex: 30,
        style: { fontSize: 17, lineHeight: 1.3 },
        content: ["服务内地金融机构200+", "服务CIPS系统直参银行20+"],
      },
      {
        id: "panel",
        type: "shape",
        role: "visualAnchor",
        x: 700,
        y: 120,
        w: 360,
        h: 320,
        zIndex: 1,
        style: { fill: "#FFF7F2", stroke: "#E5E7EB", strokeWidth: 1, radius: 20 },
        content: "",
      },
      {
        id: "outline",
        type: "shape",
        role: "outline",
        x: 700,
        y: 470,
        w: 360,
        h: 80,
        zIndex: 1,
        style: { fill: "none", stroke: "#FF4E26", strokeWidth: 2, radius: 12 },
        content: "",
      },
      {
        id: "vertical-line",
        type: "line",
        role: "connector",
        x: 620,
        y: 470,
        w: 4,
        h: 80,
        zIndex: 2,
        style: { color: "#FF4E26" },
        content: { type: "line" },
      },
      {
        id: "globe-icon",
        type: "icon",
        role: "supportingIcon",
        x: 560,
        y: 470,
        w: 40,
        h: 40,
        zIndex: 2,
        style: { color: "#FF4E26" },
        content: { name: "globe" },
      },
    ],
  },
});

const inlineDecoded = decodeSceneGraphFromText(inlineRaw, false, { canvasPreset: "pptx_16_9_1280x720" }).graph;
const inlineTitle = inlineDecoded.slide.elements.find((element) => element.id === "title");
const inlineBody = inlineDecoded.slide.elements.find((element) => element.id === "body");
const inlineBullets = inlineDecoded.slide.elements.find((element) => element.id === "bullets");
const inlinePanel = inlineDecoded.slide.elements.find((element) => element.id === "panel");
const inlineOutline = inlineDecoded.slide.elements.find((element) => element.id === "outline");
const inlineVerticalLine = inlineDecoded.slide.elements.find((element) => element.id === "vertical-line");
const inlineGlobeIcon = inlineDecoded.slide.elements.find((element) => element.id === "globe-icon");
const inlineTitleContent = inlineTitle?.content as { text?: string } | undefined;
const inlineBodyContent = inlineBody?.content as { text?: string } | undefined;
const inlineBulletsContent = inlineBullets?.content as { items?: string[] } | undefined;
const inlinePanelContent = inlinePanel?.content as { shape?: string } | undefined;

assert.equal(inlineTitle?.type, "title");
assert.equal(inlineTitleContent?.text, "数字金融：筑基数字底座，赋能开放新格局");
assert.equal(inlineBody?.type, "text");
assert.equal(inlineBodyContent?.text, "深耕国家级金融基础设施建设");
assert.equal(inlineBody?.style.fontWeight, 700);
assert.deepEqual(inlineBody?.style.fill, { type: "solid", color: "#FFF7F2" });
assert.equal(inlineBody?.style.backgroundColor, "#FFF7F2");
assert.equal(inlineBody?.style.borderColor, "#E5E7EB");
assert.equal(inlineBody?.style.borderWidth, 2);
assert.equal(inlineBody?.style.borderRadius, 16);
assert.equal(inlineBullets?.type, "bulletList");
assert.deepEqual(inlineBulletsContent?.items, ["服务内地金融机构200+", "服务CIPS系统直参银行20+"]);
assert.equal(inlinePanel?.type, "shape");
assert.equal(inlinePanelContent?.shape, "rect");
assert.deepEqual(inlinePanel?.style.fill, { type: "solid", color: "#FFF7F2" });
assert.deepEqual(inlineOutline?.style.fill, { type: "none" });
assert.equal(inlineOutline?.style.borderColor, "#FF4E26");
assert.equal(inlineOutline?.style.borderWidth, 2);
assert.deepEqual(inlineVerticalLine?.content, { direction: "vertical" });
assert.deepEqual(inlineGlobeIcon?.content, { name: "globe" });

const realRunRawDir = path.resolve("output/runs/2026-07-09T09-47-17-041Z-deckscribe-ai-workbench/raw");
const realRawFiles = [
  {
    file: path.join(realRunRawDir, "page-001.attempt-1.json.txt"),
    mustInclude: ["数字金融：筑基数字底座，赋能开放新格局", "200+", "服务 CIPS 系统直参银行"],
  },
  {
    file: path.join(realRunRawDir, "page-002.attempt-1.json.txt"),
    mustInclude: ["养老金融：构建立体服务，打造银发生态", "65%+"],
  },
];

for (const fixture of realRawFiles) {
  if (!(await exists(fixture.file))) {
    console.log(`normalization smoke skipped missing fixture: ${fixture.file}`);
    continue;
  }

  const raw = await readFile(fixture.file, "utf8");
  const graph = decodeSceneGraphFromText(raw, false, { canvasPreset: "pptx_16_9_1280x720" }).graph;
  const text = graphText(graph);
  assert.ok(!text.includes("Details pending."), `${fixture.file} should not contain Details pending.`);
  for (const expected of fixture.mustInclude) {
    assert.ok(text.includes(expected), `${fixture.file} should preserve ${expected}`);
  }
}

console.log("normalization smoke ok");
