import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  buildLlmPageContents,
  buildParsedDebugOutputPath,
  buildParsedOutputPath,
  parseDoPptCommandMessage,
} from "./parser.ts";
import { renderSceneGraphToHtml, renderSceneGraphsToHtml } from "./render.ts";
import { decodeSceneGraphFromText } from "./scene-graph-codec.ts";
import { type SceneGraph } from "./types.ts";

async function renderHtml(inputArg: string): Promise<void> {
  if (!inputArg) {
    throw new Error("Usage: npm run render -- input/slide-001.json");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const inputRaw = await readFile(inputPath, "utf8");
  let decoded;
  try {
    decoded = decodeSceneGraphFromText(inputRaw, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Input is not valid JSON: ${message}`);
  }

  const html = renderSceneGraphToHtml(decoded.graph);

  const outputDir = path.resolve(process.cwd(), "output");
  const outputName = `${path.parse(inputPath).name}.html`;
  const outputPath = path.join(outputDir, outputName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, html, "utf8");

  console.log(`HTML generated: ${outputPath}`);
  if (decoded.jsonRepaired) {
    console.log(`Input JSON was lightly repaired: ${decoded.jsonRepairNotes.join("; ")}`);
  }
  if (decoded.normalizationChanges.length > 0) {
    console.log(`Input JSON was normalized for ${decoded.normalizationChanges.length} compatibility issue(s).`);
  }
}

async function loadSceneGraphFromJson(inputPath: string): Promise<SceneGraph> {
  const inputRaw = await readFile(inputPath, "utf8");
  try {
    return decodeSceneGraphFromText(inputRaw, true).graph;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Input is not valid JSON: ${message}`);
  }
}

async function previewJson(inputArg: string): Promise<void> {
  if (!inputArg) {
    throw new Error("Usage: npm run preview-json -- output/sample/json");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const inputStat = await stat(inputPath);

  if (inputStat.isDirectory()) {
    const entries = await readdir(inputPath);
    const jsonFiles = entries
      .filter((entry) => path.extname(entry).toLowerCase() === ".json")
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (jsonFiles.length === 0) {
      throw new Error("Directory does not contain any .json files.");
    }

    const graphs: SceneGraph[] = [];
    const skipped: string[] = [];
    for (const fileName of jsonFiles) {
      try {
        graphs.push(await loadSceneGraphFromJson(path.join(inputPath, fileName)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        skipped.push(`${fileName}: ${message}`);
      }
    }

    if (graphs.length === 0) {
      throw new Error(`No valid JSON slides found. Skipped: ${skipped.join(" | ")}`);
    }

    const outputPath = path.join(path.dirname(inputPath), `${path.basename(inputPath)}.preview.html`);
    await writeFile(outputPath, renderSceneGraphsToHtml(graphs, `${path.basename(inputPath)} preview`), "utf8");
    console.log(`Preview HTML generated: ${outputPath}`);
    if (skipped.length > 0) {
      console.log(`Skipped ${skipped.length} invalid file(s):`);
      skipped.forEach((item) => console.log(`- ${item}`));
    }
    return;
  }

  if (path.extname(inputPath).toLowerCase() !== ".json") {
    throw new Error("preview-json accepts a .json file or a directory containing .json files.");
  }

  const rawInput = await readFile(inputPath, "utf8");
  let decoded;
  try {
    decoded = decodeSceneGraphFromText(rawInput, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Input is not valid JSON: ${message}`);
  }
  const outputPath = path.join(path.dirname(inputPath), `${path.parse(inputPath).name}.preview.html`);
  await writeFile(outputPath, renderSceneGraphToHtml(decoded.graph), "utf8");
  console.log(`Preview HTML generated: ${outputPath}`);
  if (decoded.jsonRepaired) {
    console.log(`Repaired JSON syntax: ${decoded.jsonRepairNotes.join("; ")}`);
  }
  if (decoded.normalizationChanges.length > 0) {
    console.log(`Normalized ${decoded.normalizationChanges.length} issue(s) before preview.`);
  }
}

async function exportPptx(inputArg: string): Promise<void> {
  if (!inputArg) {
    throw new Error("Usage: npm run export-pptx -- output/slide-001.html");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const outputDir = path.resolve(process.cwd(), "output");
  const outputName = `${path.parse(inputPath).name}.pptx`;
  const outputPath = path.join(outputDir, outputName);

  const { exportSceneGraphToPptxFile, loadSceneGraphForExport } = await import("./exporter.ts");
  const sceneGraph = await loadSceneGraphForExport(inputPath);

  await mkdir(outputDir, { recursive: true });
  await exportSceneGraphToPptxFile(sceneGraph, outputPath);

  console.log(`PPTX generated: ${outputPath}`);
}

async function parseDoPptInput(inputArg: string): Promise<void> {
  if (!inputArg) {
    throw new Error("Usage: npm run parse-do-ppt -- input/outline.txt");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const rawMessage = await readFile(inputPath, "utf8");
  const parsed = parseDoPptCommandMessage(rawMessage);
  const llmPageContents = buildLlmPageContents(parsed);
  const outputPath = buildParsedOutputPath(inputPath);
  const debugOutputPath = buildParsedDebugOutputPath(inputPath);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(llmPageContents, null, 2), "utf8");
  await writeFile(debugOutputPath, JSON.stringify(parsed, null, 2), "utf8");

  console.log(parsed.feedbackMessage);
  console.log(`LLM page slices JSON: ${outputPath}`);
  console.log(`Parse debug JSON: ${debugOutputPath}`);
}

function applyBuildDeckCliOptions(args: string[]): void {
  process.env.LLM_PAGE_GENERATION_MODE = "singlePageDirect";
  process.env.LLM_CANVAS_PRESET = "pptx_16_9_1280x720";
  for (const arg of args) {
    if (arg === "--singlePageDirect" || arg === "--single-page-direct") {
      process.env.LLM_PAGE_GENERATION_MODE = "singlePageDirect";
      process.env.LLM_CANVAS_PRESET = "pptx_16_9_1280x720";
      continue;
    }
    const mode = arg.match(/^--mode=(.+)$/)?.[1];
    if (mode) {
      process.env.LLM_PAGE_GENERATION_MODE = mode === "default" || mode === "legacy" ? mode : "singlePageDirect";
      process.env.LLM_CANVAS_PRESET = "pptx_16_9_1280x720";
      continue;
    }
    const canvas = arg.match(/^--canvas=(.+)$/)?.[1];
    if (canvas) {
      process.env.LLM_CANVAS_PRESET = "pptx_16_9_1280x720";
    }
  }
}

async function buildDeck(inputArg: string, args: string[] = []): Promise<void> {
  if (!inputArg) {
    throw new Error("Usage: npm run build-deck -- input/outline.txt");
  }

  applyBuildDeckCliOptions(args);
  const { buildDeckFromInput } = await import("./workflow.ts");
  const result = await buildDeckFromInput(inputArg);

  console.log(`Deck generated for ${result.pageCount} page(s).`);
  console.log(`Online preview HTML: ${result.finalHtmlPath}`);
  console.log(`Deck PPTX: ${result.finalPptxPath}`);
  console.log(`Workflow output dir: ${result.outputDir}`);
}

async function main(): Promise<void> {
  const inputArg = process.argv[2];
  const secondaryArg = process.argv[3];
  const restArgs = process.argv.slice(4);

  if (!inputArg) {
    throw new Error(
      "Usage: npm run render -- input/slide-001.json\n   or: npm run preview-json -- output/sample/json\n   or: npm run export-pptx -- output/slide-001.html\n   or: npm run parse-do-ppt -- input/outline.txt\n   or: npm run build-deck -- input/outline.txt",
    );
  }

  if (inputArg === "render") {
    await renderHtml(secondaryArg ?? "");
    return;
  }

  if (inputArg === "export-pptx") {
    await exportPptx(secondaryArg ?? "");
    return;
  }

  if (inputArg === "preview-json") {
    await previewJson(secondaryArg ?? "");
    return;
  }

  if (inputArg === "parse-do-ppt") {
    await parseDoPptInput(secondaryArg ?? "");
    return;
  }

  if (inputArg === "build-deck") {
    await buildDeck(secondaryArg ?? "", restArgs);
    return;
  }

  const ext = path.extname(inputArg).toLowerCase();
  if (ext === ".json") {
    await renderHtml(inputArg);
    return;
  }

  if (ext === ".html") {
    await exportPptx(inputArg);
    return;
  }

  if (ext === ".txt" || ext === ".md") {
    await parseDoPptInput(inputArg);
    return;
  }

  throw new Error(`Unsupported input: ${inputArg}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Command failed: ${message}`);
  process.exitCode = 1;
});
