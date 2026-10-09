import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { renderSceneGraphToHtml } from "./render.ts";
import { validateSceneGraph } from "./validate.ts";

async function main(): Promise<void> {
  const inputArg = process.argv[2];

  if (!inputArg) {
    throw new Error("Usage: npm run render -- input/slide-001.json");
  }

  const inputPath = path.resolve(process.cwd(), inputArg);
  const inputRaw = await readFile(inputPath, "utf8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputRaw);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error";
    throw new Error(`Input is not valid JSON: ${message}`);
  }

  const sceneGraph = validateSceneGraph(parsed);
  const html = renderSceneGraphToHtml(sceneGraph);

  const outputDir = path.resolve(process.cwd(), "output");
  const outputName = `${path.parse(inputPath).name}.html`;
  const outputPath = path.join(outputDir, outputName);

  await mkdir(outputDir, { recursive: true });
  await writeFile(outputPath, html, "utf8");

  console.log(`HTML generated: ${outputPath}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Render failed: ${message}`);
  process.exitCode = 1;
});
