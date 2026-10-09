import { strict as assert } from "node:assert";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import JSZip from "jszip";

import { exportSceneGraphsToPptxFile } from "./exporter.ts";
import { decodeSceneGraphFromText } from "./scene-graph-codec.ts";

const raw = JSON.stringify({
  version: "scene-graph/v1",
  slide: {
    id: "slide-exporter-smoke",
    width: 1280,
    height: 720,
    background: { type: "solid", color: "#FFFFFF" },
    theme: {
      fontFamily: "Noto Sans SC",
      titleColor: "#172033",
      textColor: "#172033",
      accentColor: "#FF4E26",
    },
    elements: [
      {
        id: "number",
        type: "text",
        role: "sequenceNumber",
        x: 80,
        y: 80,
        w: 64,
        h: 48,
        zIndex: 2,
        style: {
          fontSize: 24,
          fontWeight: 700,
          color: "#172033",
          backgroundColor: "#FF4E26",
          borderRadius: 8,
          textAlign: "center",
          lineHeight: 1.35,
        },
        content: { text: "01" },
      },
      {
        id: "outline",
        type: "shape",
        role: "outline",
        x: 80,
        y: 180,
        w: 360,
        h: 80,
        zIndex: 1,
        style: {
          fill: { type: "none" },
          borderColor: "#00AA00",
          borderWidth: 2,
          borderRadius: 8,
        },
        content: { shape: "rect" },
      },
      {
        id: "finance-icon",
        type: "icon",
        role: "supportingIcon",
        x: 480,
        y: 180,
        w: 48,
        h: 48,
        zIndex: 2,
        style: { color: "#145A96" },
        content: { name: "banknote" },
      },
    ],
  },
});

const graph = decodeSceneGraphFromText(raw, false, { canvasPreset: "pptx_16_9_1280x720" }).graph;
const tempDir = await mkdtemp(path.join(tmpdir(), "deckscribe-exporter-smoke-"));
const pptxPath = path.join(tempDir, "exporter-smoke.pptx");

try {
  await exportSceneGraphsToPptxFile([graph], pptxPath);
  const zip = await JSZip.loadAsync(await readFile(pptxPath));
  const slideXmlFile = zip.file("ppt/slides/slide1.xml");
  assert.ok(slideXmlFile, "exported PPTX should contain slide1.xml");
  const slideXml = await slideXmlFile.async("string");

  assert.ok(slideXml.includes('val="FF4E26"'), "text backgroundColor should be exported as an orange PPTX fill");
  assert.ok(slideXml.includes('val="00AA00"'), "transparent shape should preserve its border color");
  assert.ok(slideXml.includes('<a:alpha val="0"/>'), "fill:none should export with a fully transparent PPTX fill");
  assert.ok(slideXml.includes('<a:spcPct val="135000"/>'), "lineHeight should be exported as PPTX lineSpacingMultiple");
  const svgMediaFiles = Object.keys(zip.files).filter((name) => name.startsWith("ppt/media/") && name.endsWith(".svg"));
  assert.ok(svgMediaFiles.length > 0, "curated icons should be embedded as SVG media");
  const iconSvg = await zip.file(svgMediaFiles[0])!.async("string");
  assert.ok(iconSvg.includes("currentColor") || iconSvg.includes("145A96"), "embedded icon should retain vector color styling");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("exporter smoke ok");
