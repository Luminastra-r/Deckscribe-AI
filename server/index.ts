import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply } from "fastify";

import {
  getApiKeyValidationError,
  loadLlmConfig,
  normalizeApiKey,
  requestChatCompletionStream,
  requestChatCompletionText,
  type ChatMessage,
} from "../llm.ts";
import { buildLlmPageContents, countPageTitleMarkers, parseDoPptCommandMessage } from "../parser.ts";
import {
  buildDeckHtmlFromPages,
  exportPptxFromWorkflowOutput,
  type WorkflowProgressEvent,
} from "../workflow.ts";
import {
  BASE_PROMPT_OPTIONS,
  COLOR_STYLE_PROMPTS,
  LAYOUT_STYLE_PROMPTS,
  isAgentPromptMode,
  isColorStyleKey,
  isLayoutStyleKey,
} from "../prompt.ts";
import { readAppConfig, toLlmConfigOverrides, writeAppConfig, type AppConfig } from "./config.ts";

type JobStatus = "running" | "stopping" | "completed" | "failed" | "stopped";

type JobEvent = WorkflowProgressEvent | {
  type: "status";
  status: JobStatus;
  message: string;
} | {
  type: "deck-complete";
  pageCount: number;
  outputDir: string;
  finalHtmlPath: string;
  finalPptxPath: string;
  message: string;
};

type JobRecord = {
  id: string;
  status: JobStatus;
  controller: AbortController;
  events: JobEvent[];
  clients: Set<FastifyReply>;
  result?: unknown;
  error?: string;
};

const app = Fastify({ logger: true });
const jobs = new Map<string, JobRecord>();
let activeLlmTask: string | null = null;

const outputRoot = path.resolve(process.cwd(), "output");
const distRoot = path.resolve(process.cwd(), "dist");
const runsRoot = path.join(outputRoot, "runs");

app.addHook("onRequest", async (request, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (request.method === "OPTIONS") {
    reply.code(204).send();
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  reply.code(error.statusCode && error.statusCode >= 400 ? error.statusCode : 500).send({
    error: error.message || "Internal Server Error",
  });
});

function sendSse(reply: FastifyReply, event: JobEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function sendRawSse(reply: FastifyReply, payload: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function pushJobEvent(job: JobRecord, event: JobEvent): void {
  job.events.push(event);
  for (const client of job.clients) {
    sendSse(client, event);
  }
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const normalizedRoot = process.platform === "win32" ? root.toLowerCase() : root;
  const normalizedCandidate = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function cleanupJobLater(id: string): void {
  setTimeout(() => {
    const job = jobs.get(id);
    if (job && job.status !== "running" && job.status !== "stopping" && job.clients.size === 0) {
      jobs.delete(id);
    }
  }, 10 * 60 * 1000).unref?.();
}

function createJob(): JobRecord {
  const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: JobRecord = {
    id,
    status: "running",
    controller: new AbortController(),
    events: [],
    clients: new Set(),
  };
  jobs.set(id, job);
  return job;
}

function assertNoActiveLlmTask(): void {
  if (activeLlmTask) {
    throw new Error(`Another LLM task is already running: ${activeLlmTask}`);
  }
}

function parsePagesPayload(text: string, splitByTitleMarkers = false): {
  pages: string[];
  pageTitleIssues: Array<{ pageNumber: number; markerCount: number }>;
} {
  const parsed = parseDoPptCommandMessage(text, { splitByTitleMarkers });
  return {
    pages: buildLlmPageContents(parsed),
    pageTitleIssues: parsed.pageTitleIssues,
  };
}

function badRequest(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function maskConfig(config: AppConfig): AppConfig & { apiKeySet: boolean; apiKeyIssue?: string } {
  const normalizedApiKey = normalizeApiKey(config.apiKey);
  const apiKeyIssue = normalizedApiKey ? getApiKeyValidationError(normalizedApiKey) : undefined;
  const apiKeySet = Boolean(normalizedApiKey) && !apiKeyIssue;
  return {
    ...config,
    apiKey: apiKeySet ? "********" : "",
    apiKeySet,
    ...(apiKeyIssue ? { apiKeyIssue: "已保存的 API Key 无效，请重新输入。" } : {}),
  };
}

function firstContentLine(page: string): string {
  return page.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function validateDeckPages(pages: string[]): void {
  if (pages.length === 0) {
    throw new Error("At least one page is required.");
  }
  if (pages.length > 20) {
    throw new Error("At most 20 pages can be generated at once.");
  }
  pages.forEach((page, index) => {
    if (!page.trim()) {
      throw new Error(`Page ${index + 1} is empty.`);
    }
    if (!firstContentLine(page)) {
      throw new Error(`Page ${index + 1} is missing a title.`);
    }
    const markerCount = countPageTitleMarkers(page);
    if (markerCount > 1) {
      throw badRequest(`第 ${index + 1} 页检测到 ${markerCount} 个“页标题”，请先使用“一键按页标题拆分”。`);
    }
  });
}

function validateLlmReady(config: AppConfig): void {
  const missing = [
    !config.apiBaseUrl.trim() ? "Base URL" : "",
    !config.model.trim() ? "Model ID" : "",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw badRequest(`LLM configuration is incomplete: ${missing.join(", ")}.`);
  }
  const apiKeyError = getApiKeyValidationError(config.apiKey);
  if (apiKeyError) {
    throw badRequest(apiKeyError);
  }
}

function withApiKeyFallback(next: Partial<AppConfig>, current: AppConfig): Partial<AppConfig> {
  if (next.apiKey === "********") {
    return { ...next, apiKey: current.apiKey };
  }
  return next;
}

async function listPromptFiles(): Promise<string[]> {
  const candidates = new Set(["OUTLINE_PROMPT.md", "AGENT_PROMPT.md"]);
  const promptDir = path.resolve(process.cwd(), "prompts");
  try {
    const entries = await readdir(promptDir);
    for (const entry of entries) {
      if (entry.toLowerCase().endsWith(".md")) {
        candidates.add(path.join("prompts", entry).replace(/\\/g, "/"));
      }
    }
  } catch {
    // Optional directory.
  }
  return [...candidates];
}

async function loadPromptFile(filePath: string): Promise<string> {
  const prompts = await listPromptFiles();
  if (!prompts.includes(filePath) || path.extname(filePath).toLowerCase() !== ".md") {
    throw new Error("Invalid prompt path.");
  }
  const resolved = path.resolve(process.cwd(), filePath);
  if (!isPathInside(process.cwd(), resolved)) {
    throw new Error("Invalid prompt path.");
  }
  const raw = await readFile(resolved, "utf8");
  const fencedMatch = raw.match(/```text\s*([\s\S]*?)```/i);
  return (fencedMatch?.[1] ?? raw).trim();
}

async function buildOutlineMessages(body: {
  background?: string;
  messages?: ChatMessage[];
}, promptPath = "OUTLINE_PROMPT.md"): Promise<ChatMessage[]> {
  const prompt = await loadPromptFile(promptPath);
  return [
    {
      role: "system",
      content: prompt,
    },
    ...(body.messages ?? []),
    {
      role: "user",
      content: body.background?.trim() || "Generate PPT body text from the conversation. Separate each page with ---.",
    },
  ];
}

function buildRunId(deckName: string | undefined): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = (deckName ?? "deck").trim().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "deck";
  return `${stamp}-${suffix}`;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function resolveRunDir(runId: string): string {
  const resolved = path.resolve(runsRoot, runId);
  if (!isPathInside(runsRoot, resolved) || resolved === path.resolve(runsRoot)) {
    throw new Error("Invalid run id.");
  }
  return resolved;
}

function resolveRunOutputDir(outputDir: string): string {
  const resolved = path.resolve(outputDir);
  if (!isPathInside(runsRoot, resolved) || resolved === path.resolve(runsRoot)) {
    throw new Error("Invalid outputDir.");
  }
  return resolved;
}

async function validatePromptConfig(config: Partial<AppConfig>): Promise<void> {
  const prompts = await listPromptFiles();
  for (const key of ["outlinePromptPath", "agentPromptPath", "basePromptPath"] as const) {
    const value = config[key];
    if (value !== undefined && (!prompts.includes(value) || path.extname(value).toLowerCase() !== ".md")) {
      throw new Error(`${key} is not an allowed prompt file.`);
    }
  }
  if (config.agentPromptMode !== undefined && !isAgentPromptMode(config.agentPromptMode)) {
    throw new Error("agentPromptMode is not allowed.");
  }
  if (config.layoutStyle !== undefined && !isLayoutStyleKey(config.layoutStyle)) {
    throw new Error("layoutStyle is not allowed.");
  }
  if (config.colorStyle !== undefined && !isColorStyleKey(config.colorStyle)) {
    throw new Error("colorStyle is not allowed.");
  }
  if (
    config.pageGenerationMode !== undefined &&
    config.pageGenerationMode !== "default" &&
    config.pageGenerationMode !== "singlePageDirect"
  ) {
    throw new Error("pageGenerationMode is not allowed.");
  }
  if (
    config.canvasPreset !== undefined &&
    config.canvasPreset !== "legacy_1600x900" &&
    config.canvasPreset !== "pptx_16_9_1280x720"
  ) {
    throw new Error("canvasPreset is not allowed.");
  }
}

async function listRuns(): Promise<Array<{
  id: string;
  outputDir: string;
  pageCount: number;
  model: string;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  finalHtmlPath?: string;
  finalPptxPath?: string;
  partialHtmlPath?: string;
  errorMessage?: string;
}>> {
  try {
    const entries = await readdir(runsRoot, { withFileTypes: true });
    const runs = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const outputDir = path.join(runsRoot, entry.name);
        try {
          const manifest = await readJsonFile<{
            pageCount: number;
            model: string;
            startedAt: string;
            completedAt?: string;
            failedAt?: string;
            finalHtmlPath?: string;
            finalPptxPath?: string;
            partialHtmlPath?: string;
            errorMessage?: string;
          }>(path.join(outputDir, "manifest.json"));
          return {
            id: entry.name,
            outputDir,
            pageCount: manifest.pageCount,
            model: manifest.model,
            startedAt: manifest.startedAt,
            completedAt: manifest.completedAt,
            failedAt: manifest.failedAt,
            finalHtmlPath: manifest.finalHtmlPath,
            finalPptxPath: manifest.finalPptxPath,
            partialHtmlPath: manifest.partialHtmlPath,
            errorMessage: manifest.errorMessage,
          };
        } catch {
          return null;
        }
      }));
    return runs
      .filter((run): run is NonNullable<typeof run> => Boolean(run))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch {
    return [];
  }
}

app.get("/api/config", async () => {
  const config = await readAppConfig();
  return {
    config: maskConfig(config),
    prompts: await listPromptFiles(),
    promptOptions: {
      basePrompts: BASE_PROMPT_OPTIONS,
      layoutStyles: Object.values(LAYOUT_STYLE_PROMPTS),
      colorStyles: Object.values(COLOR_STYLE_PROMPTS),
    },
    runs: await listRuns(),
  };
});

app.put("/api/config", async (request) => {
  const current = await readAppConfig();
  const body = request.body as Partial<AppConfig>;
  const next = withApiKeyFallback(body, current);
  const normalizedApiKey = normalizeApiKey(next.apiKey ?? "");
  const apiKeyError = getApiKeyValidationError(normalizedApiKey);
  if (apiKeyError) {
    throw badRequest(apiKeyError);
  }
  const normalizedNext = { ...next, apiKey: normalizedApiKey };
  await validatePromptConfig(normalizedNext);
  const saved = await writeAppConfig(normalizedNext);
  return { config: maskConfig(saved) };
});

app.post("/api/config/test", async () => {
  assertNoActiveLlmTask();
  activeLlmTask = "testing-config";
  try {
    const appConfig = await readAppConfig();
    validateLlmReady(appConfig);
    const config = loadLlmConfig({
      ...toLlmConfigOverrides(appConfig),
      jsonResponseMode: "off",
      timeoutMs: Math.min(appConfig.timeoutMs || 30000, 30000),
    });
    const startedAt = Date.now();
    await requestChatCompletionText(config, [
      { role: "user", content: "Reply with exactly one short word: ok" },
    ], { maxTokens: 8 });
    return { ok: true, latencyMs: Date.now() - startedAt };
  } finally {
    activeLlmTask = null;
  }
});

app.post("/api/outline/chat", async (request) => {
  assertNoActiveLlmTask();
  activeLlmTask = "outline-chat";
  try {
    const body = request.body as {
      background?: string;
      messages?: ChatMessage[];
    };
    const appConfig = await readAppConfig();
    validateLlmReady(appConfig);
    const config = loadLlmConfig({
      ...toLlmConfigOverrides(appConfig),
      jsonResponseMode: "off",
    });
    const content = await requestChatCompletionText(config, await buildOutlineMessages(body, appConfig.outlinePromptPath));
    return { content };
  } finally {
    activeLlmTask = null;
  }
});

app.post("/api/outline/chat/stream", async (request, reply) => {
  assertNoActiveLlmTask();
  activeLlmTask = "outline-chat";
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const controller = new AbortController();
  let completed = false;
  let receivedDelta = false;
  request.raw.on("aborted", () => controller.abort());
  reply.raw.on("close", () => {
    if (!completed) {
      controller.abort();
    }
  });

  try {
    const body = request.body as {
      background?: string;
      messages?: ChatMessage[];
    };
    const appConfig = await readAppConfig();
    validateLlmReady(appConfig);
    const config = loadLlmConfig({
      ...toLlmConfigOverrides(appConfig),
      jsonResponseMode: "off",
      progressIntervalMs: 10000,
    });
    sendRawSse(reply, {
      type: "status",
      message: "已连接本地服务，正在等待模型流式响应...",
    });
    await requestChatCompletionStream(config, await buildOutlineMessages(body, appConfig.outlinePromptPath), {
      signal: controller.signal,
      idleTimeoutMs: appConfig.outlineStreamIdleTimeoutMs,
      onDelta: (delta) => {
        receivedDelta = true;
        sendRawSse(reply, { type: "delta", delta });
      },
    });
    if (!receivedDelta) {
      throw new Error("LLM stream completed without any text. The provider may not support streaming for this model; try testing the model or switching endpoint/model.");
    }
    sendRawSse(reply, { type: "done" });
    completed = true;
  } catch (error) {
    completed = true;
    sendRawSse(reply, {
      type: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    activeLlmTask = null;
    reply.raw.end();
  }
});

app.post("/api/pages/parse", async (request) => {
  const body = request.body as { text?: string; splitByTitleMarkers?: boolean };
  const parsed = parsePagesPayload(body.text ?? "", body.splitByTitleMarkers === true);
  return {
    pageCount: parsed.pages.length,
    pages: parsed.pages.map((content, index) => ({
      id: `page-${index + 1}`,
      pageNumber: index + 1,
      content,
    })),
    pageTitleIssues: parsed.pageTitleIssues,
  };
});

type GenerateDeckRequestBody = {
  pages?: Array<{ content?: string } | string>;
  deckName?: string;
  outputDir?: string;
};

async function startDeckJob(body: GenerateDeckRequestBody, autoExportPptx: boolean): Promise<{ jobId: string }> {
  assertNoActiveLlmTask();
  const pages = (body.pages ?? [])
    .map((page) => typeof page === "string" ? page : page.content ?? "")
    .map((page) => page.trim())
    .filter(Boolean);
  validateDeckPages(pages);

  const appConfig = await readAppConfig();
  validateLlmReady(appConfig);
  await validatePromptConfig({
    outlinePromptPath: appConfig.outlinePromptPath,
    agentPromptPath: appConfig.agentPromptPath,
    agentPromptMode: appConfig.agentPromptMode,
    basePromptPath: appConfig.basePromptPath,
    layoutStyle: appConfig.layoutStyle,
    colorStyle: appConfig.colorStyle,
    pageGenerationMode: appConfig.pageGenerationMode,
    canvasPreset: appConfig.canvasPreset,
  });

  const job = createJob();
  activeLlmTask = job.id;

  const outputDir = body.outputDir
    ? resolveRunOutputDir(body.outputDir)
    : path.join(runsRoot, buildRunId(body.deckName));

  void buildDeckHtmlFromPages(pages, {
    deckName: "deck",
    outputDir,
    config: toLlmConfigOverrides(appConfig),
    agentPromptPath: appConfig.agentPromptPath,
    agentPromptMode: appConfig.agentPromptMode,
    basePromptPath: appConfig.basePromptPath,
    layoutStyle: appConfig.layoutStyle,
    colorStyle: appConfig.colorStyle,
    pageGenerationMode: appConfig.pageGenerationMode,
    signal: job.controller.signal,
    onProgress: (event) => pushJobEvent(job, event),
  })
    .then(async (result) => {
      if (autoExportPptx) {
        pushJobEvent(job, { type: "status", status: "running", message: "正在导出 PPTX" });
        const pptxResult = await exportPptxFromWorkflowOutput(result.outputDir);
        const completedResult = { ...result, ...pptxResult };
        job.status = "completed";
        job.result = completedResult;
        pushJobEvent(job, {
          type: "deck-complete",
          pageCount: completedResult.pageCount,
          outputDir: completedResult.outputDir,
          finalHtmlPath: completedResult.finalHtmlPath,
          finalPptxPath: completedResult.finalPptxPath,
          message: "PPTX 已生成",
        });
        pushJobEvent(job, { type: "status", status: "completed", message: "PPTX 已生成" });
        return;
      }
      job.status = "completed";
      job.result = result;
      pushJobEvent(job, { type: "status", status: "completed", message: "页面预览已生成，可以导出 PPTX" });
    })
    .catch((error: unknown) => {
      job.status = job.controller.signal.aborted ? "stopped" : "failed";
      job.error = error instanceof Error ? error.message : String(error);
      pushJobEvent(job, { type: "status", status: job.status, message: job.error });
    })
    .finally(() => {
      if (activeLlmTask === job.id) {
        activeLlmTask = null;
      }
      cleanupJobLater(job.id);
    });

  return { jobId: job.id };
}

app.post("/api/deck/generate", async (request) => {
  return startDeckJob(request.body as GenerateDeckRequestBody, true);
});

app.post("/api/deck/generate-html", async (request) => {
  return startDeckJob(request.body as GenerateDeckRequestBody, false);
});

app.get("/api/jobs/:id/events", async (request, reply) => {
  const { id } = request.params as { id: string };
  const job = jobs.get(id);
  if (!job) {
    reply.code(404);
    return { error: "Job not found." };
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  for (const event of job.events) {
    sendSse(reply, event);
  }
  job.clients.add(reply);
  request.raw.on("close", () => job.clients.delete(reply));
});

app.post("/api/jobs/:id/stop", async (request) => {
  const { id } = request.params as { id: string };
  const job = jobs.get(id);
  if (!job) {
    throw new Error("Job not found.");
  }
  if (job.status !== "running") {
    return { ok: true, status: job.status };
  }
  job.controller.abort();
  job.status = "stopping";
  pushJobEvent(job, { type: "status", status: "stopping", message: "Stopping job..." });
  return { ok: true, status: "stopping" };
});

app.post("/api/deck/export-pptx", async (request) => {
  const body = request.body as { outputDir?: string };
  if (!body.outputDir) {
    throw new Error("outputDir is required.");
  }
  return await exportPptxFromWorkflowOutput(resolveRunOutputDir(body.outputDir));
});

app.get("/api/deck/runs", async () => {
  return { runs: await listRuns() };
});

app.get("/api/deck/runs/:id", async (request) => {
  const { id } = request.params as { id: string };
  const outputDir = resolveRunDir(id);
  const manifest = await readJsonFile<{
    pagesPath?: string;
    finalHtmlPath?: string;
    finalPptxPath?: string;
    partialHtmlPath?: string;
    failedPageNumber?: number;
    errorMessage?: string;
  }>(path.join(outputDir, "manifest.json"));
  const pages = manifest.pagesPath ? await readJsonFile<string[]>(manifest.pagesPath) : [];
  return {
    id,
    outputDir,
    pages,
    finalHtmlPath: manifest.finalHtmlPath,
    finalPptxPath: manifest.finalPptxPath,
    partialHtmlPath: manifest.partialHtmlPath,
    failedPageNumber: manifest.failedPageNumber,
    errorMessage: manifest.errorMessage,
  };
});

app.delete("/api/deck/runs/:id", async (request) => {
  const { id } = request.params as { id: string };
  await rm(resolveRunDir(id), { recursive: true, force: true });
  return { ok: true, runs: await listRuns() };
});

app.get("/api/files", async (request, reply) => {
  const { path: requestedPath } = request.query as { path?: string };
  if (!requestedPath) {
    throw new Error("path is required.");
  }
  const resolved = path.resolve(requestedPath);
  if (!isPathInside(outputRoot, resolved)) {
    throw new Error("Only files under output/ can be downloaded.");
  }
  const fileStat = await stat(resolved);
  if (!fileStat.isFile()) {
    throw new Error("Only files can be downloaded.");
  }
  const extension = path.extname(resolved).toLowerCase();
  if (extension === ".html") {
    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Content-Disposition", "inline");
  } else if (extension === ".pptx") {
    reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.presentationml.presentation");
  } else {
    throw new Error("Only .html and .pptx output files can be downloaded.");
  }
  return reply.send(createReadStream(resolved));
});

try {
  await stat(distRoot);
  await app.register(fastifyStatic, {
    root: distRoot,
    prefix: "/",
  });
  app.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      reply.code(404).send({ error: "Not found." });
      return;
    }
    reply.sendFile("index.html");
  });
} catch {
  // Vite serves the app during development.
}

await mkdir(outputRoot, { recursive: true });
const port = Number(process.env.PORT ?? 4172);
await app.listen({ host: "127.0.0.1", port });
