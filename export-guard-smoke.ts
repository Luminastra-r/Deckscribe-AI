import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { exportPptxFromWorkflowOutput } from "./workflow.ts";

const tempDir = await mkdtemp(path.join(os.tmpdir(), "deckscribe-export-guard-"));
try {
  const pagesPath = path.join(tempDir, "pages.json");
  const htmlPath = path.join(tempDir, "deck.html");
  const jsonPath = path.join(tempDir, "page-001.json");
  const planPath = path.join(tempDir, "page-001.pptx-plan.json");
  const manifestPath = path.join(tempDir, "manifest.json");

  await writeFile(pagesPath, JSON.stringify(["页标题：不能导出空白页\n正文包含2026年目标"]), "utf8");
  await writeFile(htmlPath, "<!doctype html><title>preview</title>", "utf8");
  await writeFile(jsonPath, JSON.stringify({
    version: "scene-graph/v1",
    slide: {
      id: "page-001",
      width: 1280,
      height: 720,
      background: { type: "solid", color: "#FFFFFF" },
      theme: {},
      elements: [],
    },
  }), "utf8");
  await writeFile(planPath, "{}", "utf8");
  await writeFile(manifestPath, JSON.stringify({
    pageCount: 1,
    pagesPath,
    finalHtmlPath: htmlPath,
    finalPptxPath: path.join(tempDir, "should-not-exist.pptx"),
    pages: [{
      pageNumber: 1,
      status: "json_valid",
      pptxPageStatus: "json_valid",
      jsonPath,
      pptxPlanPath: planPath,
    }],
  }), "utf8");

  await assert.rejects(() => exportPptxFromWorkflowOutput(tempDir), /PPTX export blocked for page 1/);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.finalPptxPath, undefined);
  assert.equal(manifest.failedPageNumber, 1);
  assert.equal(manifest.pages[0].status, "failed");
  assert.equal(manifest.pages[0].pptxPageStatus, "failed");
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log("EXPORT_GUARD_SMOKE_OK");
