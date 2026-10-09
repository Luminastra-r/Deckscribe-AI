import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadPromptTemplate } from "./prompt.ts";
import { DEFAULT_CANVAS_PRESET, type CanvasPreset } from "./types.ts";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmConfig = {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  pageGenerationMode: "default" | "singlePageDirect";
  canvasPreset: CanvasPreset;
  pipelineMode: "single-step" | "two-step";
  enablePagePlan: boolean;
  enableQualityRetry: boolean;
  enforcePptxParity: boolean;
  blockOnLayoutWarnings: boolean;
  layoutFreedom: "high" | "balanced";
  temperature: number;
  jsonResponseMode: "auto" | "json_object" | "off";
  timeoutMs: number;
  progressIntervalMs: number;
  stepDelayMs: number;
  successStepDelayMs: number;
  pageDelayMs: number;
  enforceMinPageDelayMs: number;
  allowUnsafeFastMode: boolean;
  maxRetries: number;
  retryDelayMs: number;
  transientRetryDelayMs: number;
  emptyResponseExtraRetries: number;
  layoutRefinementExtraRetries: number;
  mockResponsePath?: string;
};

export type LlmConfigOverrides = Partial<LlmConfig>;

export type LlmRequestOptions = {
  signal?: AbortSignal;
  maxTokens?: number;
  streamFallback?: boolean;
};

export type LlmStreamOptions = LlmRequestOptions & {
  onDelta: (delta: string) => void;
  idleTimeoutMs?: number;
};

export const INVALID_API_KEY_MESSAGE =
  "API Key 配置无效：只能包含 Bearer Token 支持的字母、数字及 -._~+/=，不能包含中文、空白、控制字符或其他正文内容，请重新输入模型服务提供的密钥。";

export function normalizeApiKey(apiKey: string): string {
  return apiKey.trim();
}

export function getApiKeyValidationError(apiKey: string): string | undefined {
  const normalized = normalizeApiKey(apiKey);
  if (!normalized) {
    return "请先填写 API Key。";
  }
  return /^[A-Za-z0-9\-._~+/]+=*$/.test(normalized) ? undefined : INVALID_API_KEY_MESSAGE;
}

export type SceneGraphRepairContext = {
  previousJsonText: string;
  validationError: string;
};

type ChatCompletionChoice = {
  text?: string;
  message?: {
    content?: string | Array<{ type?: string; text?: string }>;
    reasoning_content?: string;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
};

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_PROGRESS_INTERVAL_MS = 30_000;
const DEFAULT_STEP_DELAY_MS = 0;
const DEFAULT_SUCCESS_STEP_DELAY_MS = 0;
const DEFAULT_PAGE_DELAY_MS = 0;
const DEFAULT_ENFORCE_MIN_PAGE_DELAY_MS = 0;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_TRANSIENT_RETRY_DELAY_MS = 5_000;
const DEFAULT_EMPTY_RESPONSE_EXTRA_RETRIES = 1;
const DEFAULT_LAYOUT_REFINEMENT_EXTRA_RETRIES = 0;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_JSON_RESPONSE_MODE: LlmConfig["jsonResponseMode"] = "auto";

function toPipelineMode(value: string | undefined): LlmConfig["pipelineMode"] {
  return value?.trim().toLowerCase() === "two-step" ? "two-step" : "single-step";
}

function toPageGenerationMode(value: string | undefined): LlmConfig["pageGenerationMode"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "default" || normalized === "legacy" ? "default" : "singlePageDirect";
}

function toCanvasPreset(value: string | undefined, fallback: CanvasPreset): CanvasPreset {
  const normalized = value?.trim();
  return normalized === "pptx_16_9_1280x720" || normalized === "legacy_1600x900" ? normalized : fallback;
}

function toLayoutFreedom(value: string | undefined): LlmConfig["layoutFreedom"] {
  return value?.trim().toLowerCase() === "balanced" ? "balanced" : "high";
}

function toPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function toTemperature(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toJsonResponseMode(value: string | undefined, fallback: LlmConfig["jsonResponseMode"]): LlmConfig["jsonResponseMode"] {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "off" || normalized === "none") {
    return "off";
  }
  if (normalized === "json_object" || normalized === "json") {
    return "json_object";
  }
  if (normalized === "auto" || !normalized) {
    return fallback;
  }
  return fallback;
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolveMockResponsePath(pageNumber: number, mockResponsePath: string): string {
  const resolved = path.resolve(process.cwd(), mockResponsePath);
  if (path.extname(resolved)) {
    return resolved;
  }

  return path.join(resolved, `page-${String(pageNumber).padStart(3, "0")}.json`);
}

function normalizeChatContent(content: string | Array<{ type?: string; text?: string }> | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("");
  }

  return "";
}

function summarizeRawBody(rawBody: string): string {
  return rawBody.replace(/\s+/g, " ").trim().slice(0, 500);
}

function extractChoiceContent(choice: ChatCompletionChoice | undefined): string {
  if (!choice) {
    return "";
  }

  const messageContent = normalizeChatContent(choice.message?.content);
  if (messageContent.trim()) {
    return messageContent;
  }

  if (typeof choice.text === "string" && choice.text.trim()) {
    return choice.text;
  }

  return "";
}

function isNullChoicesEnvelope(payload: ChatCompletionResponse | undefined): boolean {
  if (!payload || payload.error) {
    return false;
  }

  if (Array.isArray(payload.choices) && payload.choices.length > 0) {
    return false;
  }

  return (payload.usage?.total_tokens ?? 0) === 0;
}

function extractJsonPayload(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export function isLayoutDensityErrorMessage(message: string): boolean {
  return /layout density too low/i.test(message);
}

export function isPlanAlignmentErrorMessage(message: string): boolean {
  return /plan alignment too low/i.test(message);
}

export function isExportSafetyErrorMessage(message: string): boolean {
  return /export safety too low|not export-safe|pptx parity too low/i.test(message);
}

export function isQuotaExceededErrorMessage(message: string): boolean {
  return (
    /insufficient_quota/i.test(message) ||
    /quota/i.test(message) ||
    /rate limit/i.test(message) ||
    /daily request/i.test(message) ||
    /requests?\s+per\s+day/i.test(message) ||
    /request count limit/i.test(message) ||
    /当日请求次数上限/i.test(message) ||
    /今日请求次数上限/i.test(message) ||
    /额度已用尽/i.test(message)
  );
}

export function isFatalLlmErrorMessage(message: string): boolean {
  return (
    isQuotaExceededErrorMessage(message) ||
    /unauthorized/i.test(message) ||
    /forbidden/i.test(message) ||
    /invalid api key/i.test(message) ||
    /\b401\b/.test(message) ||
    /\b403\b/.test(message)
  );
}

function buildLayoutDensitySuggestions(validationError: string): string[] {
  const suggestions: string[] = [
    "Preserve more of the original page detail. Do not summarize away meaningful points.",
    "Use more of the 16:9 canvas before cutting content.",
  ];

  if (/large containers are too empty/i.test(validationError)) {
    suggestions.push("Shrink oversized cards or panels, or fill them with additional supporting detail from the input.");
    suggestions.push("Avoid tall containers that contain only two or three short lines.");
  }

  if (/compressed away/i.test(validationError)) {
    suggestions.push("Keep more of the original statements, evidence, qualifiers, and sub-points from the input.");
  }

  if (/not decomposed into enough visual blocks/i.test(validationError)) {
    suggestions.push("Break long passages into bullets, grouped callouts, process steps, comparison blocks, or summary bands.");
  }

  if (/slide remains unused/i.test(validationError)) {
    suggestions.push("Redistribute content vertically and horizontally so the lower half of the slide is also meaningfully used.");
  }

  suggestions.push("Avoid one or two oversized containers with large blank lower areas.");
  suggestions.push("Use balanced supporting blocks, chips, or bullets instead of leaving large decorative emptiness.");
  if (/top-heavy/i.test(validationError)) {
    suggestions.push("Reduce crowding in the upper section and move more meaningful detail into the middle or lower regions.");
  }

  return suggestions;
}

function buildPlanAlignmentSuggestions(validationError: string): string[] {
  const suggestions: string[] = [
    "Follow the page-plan's layout family and region hierarchy more closely.",
    "Keep one dominant framing region instead of flattening every block to the same weight.",
  ];

  if (/mechanical equal-card grid/i.test(validationError)) {
    suggestions.push("Do not use a uniform grid of identical cards for repeated actions unless the plan explicitly calls for strict equivalence.");
    suggestions.push("Introduce a rail, hero block, or weighted action cluster so the page has a clear primary-secondary rhythm.");
    suggestions.push("Prefer frameworkRail plus actionCardGroup over manually repeating shape + title + text cards.");
  }

  if (/framing rail/i.test(validationError)) {
    suggestions.push("Reserve a visible left or top framework region before expanding supporting actions.");
  }

  if (/bottom summary/i.test(validationError)) {
    suggestions.push("Preserve the page objective or closing judgement in a bottom summary band or clear concluding block.");
  }
  if (/header crowding/i.test(validationError)) {
    suggestions.push("Protect the title band and push the first content region lower so the title and intro remain visually independent.");
  }
  if (/card text starvation/i.test(validationError)) {
    suggestions.push("Enlarge small cards, reduce the number of cards, or redistribute detail so titles and body copy have enough text area.");
  }
  if (/stacked icon penalty/i.test(validationError)) {
    suggestions.push("Use inline icon placement inside dense or small cards instead of dedicating a separate row to the icon.");
  }
  if (/title fragmentation/i.test(validationError)) {
    suggestions.push("Keep short card titles as single readable blocks; remove eyebrow or decoration before shrinking or over-wrapping the title.");
  }
  if (/visual aid overload/i.test(validationError)) {
    suggestions.push("Lower the visual aid budget by removing non-essential badges, chips, or stacked decorative layers.");
  }
  if (/container mismatch/i.test(validationError)) {
    suggestions.push("Resize oversized containers or split overloaded ones so content weight matches the container size.");
  }

  return suggestions;
}

function buildExportSafetySuggestions(validationError: string): string[] {
  const suggestions: string[] = [
    "Prefer low-level editable PPTX primitives such as title, text, bulletList, shape, line, connector, icon, and grid.",
    "Prefer legal scene-graph elements over browser-only decoration.",
    "Do not add pageBadge unless page numbering or a corner status marker is explicitly required.",
    "Keep text/background contrast explicit so decorative surfaces never swallow the copy.",
  ];

  if (/raw svg/i.test(validationError)) {
    suggestions.push("Replace raw svg structures with low-level shapes, lines, connectors, icons, or grid elements.");
  }

  if (/donut charts with too many segments/i.test(validationError)) {
    suggestions.push("Reduce donut chart segments or switch to a bar/progress chart when the comparison is dense.");
  }

  if (/connector/i.test(validationError)) {
    suggestions.push("Simplify overloaded connectors into grouped process steps or a cleaner process/swimlane primitive.");
  }

  if (/html is not export-safe|backdrop-filter|gradient/i.test(validationError)) {
    suggestions.push("Use flat fills, solid borders, and simple shadows only. Avoid browser-only filters or gradients.");
  }

  if (/parity/i.test(validationError)) {
    suggestions.push("Make sure major regions include stable editable visual aids such as icons, labels, lines, shapes, or grids.");
    suggestions.push("Keep the composition low-level; do not convert shape + title + text clusters into high-level component primitives.");
  }

  return suggestions;
}

function buildValidationRepairMessage(validationError: string, config?: LlmConfig): string {
  const canvas = config?.canvasPreset === "pptx_16_9_1280x720"
    ? { width: 1280, height: 720 }
    : { width: 1600, height: 900 };
  if (isLayoutDensityErrorMessage(validationError)) {
    const suggestions = buildLayoutDensitySuggestions(validationError);
    return [
      "Refine the previous scene-graph JSON. Keep the same topic and preserve source detail.",
      `Issue: ${validationError.trim()}`,
      "Focus only on the failed constraints below.",
      ...suggestions.slice(0, 2).map((item, index) => `${index + 1}. ${item}`),
      `3. Keep every element inside ${canvas.width}x${canvas.height} and maintain legal scene-graph JSON.`,
      "Return exactly one JSON object and nothing else.",
    ].join("\n");
  }

  if (isPlanAlignmentErrorMessage(validationError)) {
    const suggestions = buildPlanAlignmentSuggestions(validationError);
    return [
      "Refine the previous scene-graph JSON to better match the page plan.",
      `Issue: ${validationError.trim()}`,
      "Focus only on the failed constraints below.",
      ...suggestions.slice(0, 2).map((item, index) => `${index + 1}. ${item}`),
      `3. Preserve source detail instead of collapsing it into generic repeated cards.`,
      `4. Keep every element inside ${canvas.width}x${canvas.height} and maintain legal scene-graph JSON.`,
      "Return exactly one JSON object and nothing else.",
    ].join("\n");
  }

  if (isExportSafetyErrorMessage(validationError)) {
    const suggestions = buildExportSafetySuggestions(validationError);
    return [
      "Refine the previous scene-graph JSON to improve export safety.",
      `Issue: ${validationError.trim()}`,
      "Focus only on the failed constraints below.",
      ...suggestions.slice(0, 2).map((item, index) => `${index + 1}. ${item}`),
      `3. Keep every element inside ${canvas.width}x${canvas.height} and maintain legal scene-graph JSON.`,
      "Return exactly one JSON object and nothing else.",
    ].join("\n");
  }

  return [
    "Your previous scene-graph output failed validation.",
    "Repair the previous JSON instead of redesigning the slide from scratch.",
    `Validation error: ${validationError.trim()}`,
    "Return exactly one valid JSON object and nothing else.",
    "Do not use Markdown fences. Do not explain. Do not prepend or append text.",
    "Treat the provided page content as already sized for one slide. Do not proactively summarize or compress it unless absolutely necessary for fit.",
    "If there is available space, preserve more detail and split long passages into multiple visual blocks instead of one sparse paragraph.",
    "Hard requirements:",
    "1. Every element must include id, type, role, x, y, w, h, zIndex, style, content.",
    "2. All required strings must be non-empty.",
    "3. title/text elements must use content.text.",
    "4. callout must include non-empty content.title and content.text.",
    "5. bulletList.content.items must be a non-empty array of non-empty strings.",
      `6. Every element must stay inside ${canvas.width}x${canvas.height} with x >= 0, y >= 0, w > 0, h > 0, x + w <= ${canvas.width}, y + h <= ${canvas.height}.`,
      "7. If any complex structure is risky, simplify it to a legal element instead of keeping invalid JSON.",
      "8. Escape any double quotes inside string values.",
      "9. Avoid large empty cards with only a few short lines.",
      "10. Use the open space on the slide before dropping important input detail.",
      "11. Keep text and its decorative background in clearly different tones so labels, chips, and cards remain readable.",
      "12. Do not use gradients or simulated gradients; use solid fills only.",
    ].join("\n");
}

export function loadLlmConfigFromEnv(): LlmConfig {
  const allowUnsafeFastMode = toBoolean(process.env.LLM_ALLOW_UNSAFE_FAST_MODE, false);
  const pageGenerationMode = toPageGenerationMode(process.env.LLM_PAGE_GENERATION_MODE ?? process.env.LLM_GENERATION_MODE);
  const canvasPreset = toCanvasPreset(
    process.env.LLM_CANVAS_PRESET,
    DEFAULT_CANVAS_PRESET,
  );
  const pipelineMode = toPipelineMode(process.env.LLM_PIPELINE_MODE);
  const enablePagePlan = toBoolean(process.env.LLM_ENABLE_PAGE_PLAN, pipelineMode === "two-step");
  const enableQualityRetry = toBoolean(process.env.LLM_ENABLE_QUALITY_RETRY, false);
  const enforcePptxParity = toBoolean(process.env.LLM_ENFORCE_PPTX_PARITY, false);
  const blockOnLayoutWarnings = toBoolean(process.env.LLM_BLOCK_ON_LAYOUT_WARNINGS, false);
  const layoutFreedom = toLayoutFreedom(process.env.LLM_LAYOUT_FREEDOM);
  const enforceMinPageDelayMs = toPositiveInteger(
    process.env.LLM_ENFORCE_MIN_PAGE_DELAY_MS,
    DEFAULT_ENFORCE_MIN_PAGE_DELAY_MS,
  );
  const requestedPageDelayMs = toPositiveInteger(process.env.LLM_PAGE_DELAY_MS, DEFAULT_PAGE_DELAY_MS);
  const retryDelayMs = toPositiveInteger(process.env.LLM_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);

  return {
    apiBaseUrl: process.env.LLM_API_BASE_URL?.trim() ?? "",
    apiKey: process.env.LLM_API_KEY?.trim() ?? "",
    model: process.env.LLM_MODEL?.trim() ?? "",
    pageGenerationMode,
    canvasPreset,
    pipelineMode,
    enablePagePlan,
    enableQualityRetry,
    enforcePptxParity,
    blockOnLayoutWarnings,
    layoutFreedom,
    temperature: toTemperature(process.env.LLM_TEMPERATURE, DEFAULT_TEMPERATURE),
    jsonResponseMode: toJsonResponseMode(process.env.LLM_JSON_RESPONSE_MODE, DEFAULT_JSON_RESPONSE_MODE),
    timeoutMs: toPositiveInteger(process.env.LLM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    progressIntervalMs: toPositiveInteger(process.env.LLM_PROGRESS_INTERVAL_MS, DEFAULT_PROGRESS_INTERVAL_MS),
    stepDelayMs: toPositiveInteger(process.env.LLM_STEP_DELAY_MS, DEFAULT_STEP_DELAY_MS),
    successStepDelayMs: toPositiveInteger(process.env.LLM_SUCCESS_STEP_DELAY_MS, DEFAULT_SUCCESS_STEP_DELAY_MS),
    pageDelayMs: allowUnsafeFastMode
      ? requestedPageDelayMs
      : Math.max(requestedPageDelayMs, enforceMinPageDelayMs),
    enforceMinPageDelayMs,
    allowUnsafeFastMode,
    maxRetries: Math.max(1, toPositiveInteger(process.env.LLM_MAX_RETRIES, DEFAULT_MAX_RETRIES)),
    retryDelayMs,
    transientRetryDelayMs: toPositiveInteger(process.env.LLM_TRANSIENT_RETRY_DELAY_MS, retryDelayMs || DEFAULT_TRANSIENT_RETRY_DELAY_MS),
    emptyResponseExtraRetries: Math.max(0, toPositiveInteger(process.env.LLM_EMPTY_RESPONSE_EXTRA_RETRIES, DEFAULT_EMPTY_RESPONSE_EXTRA_RETRIES)),
    layoutRefinementExtraRetries: Math.max(
      0,
      toPositiveInteger(
        process.env.LLM_LAYOUT_REFINEMENT_EXTRA_RETRIES,
        enableQualityRetry ? DEFAULT_LAYOUT_REFINEMENT_EXTRA_RETRIES : 0,
      ),
    ),
    mockResponsePath: process.env.LLM_MOCK_RESPONSE_PATH?.trim() || undefined,
  };
}

export function loadLlmConfig(overrides: LlmConfigOverrides = {}): LlmConfig {
  const config = {
    ...loadLlmConfigFromEnv(),
    ...overrides,
  };
  if (config.pageGenerationMode === "singlePageDirect") {
    return {
      ...config,
      pipelineMode: "single-step",
      enablePagePlan: false,
      enableQualityRetry: false,
      enforcePptxParity: false,
      blockOnLayoutWarnings: false,
      layoutFreedom: "high",
      canvasPreset: overrides.canvasPreset ?? DEFAULT_CANVAS_PRESET,
      layoutRefinementExtraRetries: 0,
    };
  }
  return {
    ...config,
    pageGenerationMode: "singlePageDirect",
    pipelineMode: "single-step",
    enablePagePlan: false,
    enableQualityRetry: false,
    enforcePptxParity: false,
    blockOnLayoutWarnings: false,
    layoutFreedom: "high",
    canvasPreset: overrides.canvasPreset ?? DEFAULT_CANVAS_PRESET,
    layoutRefinementExtraRetries: 0,
  };
}

export function isEmptyResponseErrorMessage(message: string): boolean {
  return /empty response|null choices envelope/i.test(message);
}

export function isTransientLlmErrorMessage(message: string): boolean {
  if (isFatalLlmErrorMessage(message)) {
    return false;
  }
  return (
    isEmptyResponseErrorMessage(message) ||
    /timeout/i.test(message) ||
    /network/i.test(message) ||
    /fetch failed/i.test(message) ||
    /socket/i.test(message) ||
    /temporar/i.test(message) ||
    /\b5\d{2}\b/.test(message) ||
    (/\b429\b/.test(message) && !isQuotaExceededErrorMessage(message))
  );
}

export async function loadAgentPromptTemplate(): Promise<string> {
  return loadPromptTemplate("AGENT_PROMPT.md");
}

async function requestMockResponse(pageNumber: number, mockResponsePath: string): Promise<string> {
  const filePath = resolveMockResponsePath(pageNumber, mockResponsePath);
  return readFile(filePath, "utf8");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error("Operation aborted.");
  }
}

function buildAbortSignal(timeoutMs: number, signal: AbortSignal | undefined): {
  signal?: AbortSignal;
  cleanup: () => void;
} {
  if (timeoutMs <= 0 && !signal) {
    return { signal: undefined, cleanup: () => undefined };
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  if (timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(new Error(`LLM request timed out after ${timeoutMs}ms.`)), timeoutMs);
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function buildChatCompletionsEndpoint(apiBaseUrl: string): string {
  const normalized = apiBaseUrl.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(normalized) ? normalized : `${normalized}/chat/completions`;
}

export function buildOpenAiCompatibleHeaders(apiKey: string): Record<string, string> {
  const normalizedApiKey = normalizeApiKey(apiKey);
  const apiKeyError = getApiKeyValidationError(normalizedApiKey);
  if (apiKeyError) {
    throw new Error(apiKeyError);
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${normalizedApiKey}`,
    "HTTP-Referer": "http://127.0.0.1",
    "X-Title": "Deckscribe-AI",
  };
}

function buildChatCompletionPayload(
  config: LlmConfig,
  messages: ChatMessage[],
  options: LlmRequestOptions,
): {
  model: string;
  temperature: number;
  messages: ChatMessage[];
  max_tokens?: number;
} {
  return {
    model: config.model,
    temperature: config.temperature,
    messages,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
  };
}

function shouldUseStreamFallback(options: LlmRequestOptions): boolean {
  return options.streamFallback !== false;
}

async function collectChatCompletionStream(
  config: LlmConfig,
  messages: ChatMessage[],
  options: LlmRequestOptions,
): Promise<string> {
  let text = "";
  await requestChatCompletionStream(config, messages, {
    ...options,
    streamFallback: false,
    onDelta: (delta) => {
      text += delta;
    },
  });
  return text;
}

export async function requestChatCompletionText(
  config: LlmConfig,
  messages: ChatMessage[],
  options: LlmRequestOptions = {},
): Promise<string> {
  if (!config.apiBaseUrl || !config.apiKey || !config.model) {
    throw new Error("LLM_API_BASE_URL, LLM_API_KEY, and LLM_MODEL must be set.");
  }

  throwIfAborted(options.signal);

  const endpoint = buildChatCompletionsEndpoint(config.apiBaseUrl);
  const startedAt = Date.now();
  const progressTimer =
    config.progressIntervalMs > 0
      ? setInterval(() => {
          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
          console.log(`LLM request still pending after ${elapsedSeconds}s: ${config.model}`);
        }, config.progressIntervalMs)
      : undefined;

  const requestSignal = buildAbortSignal(config.timeoutMs, options.signal);

  let rawBody = "";

  const shouldRequestJsonMode = config.jsonResponseMode !== "off";
  const requestPayloadBase = buildChatCompletionPayload(config, messages, options);

  const sendRequest = async (useJsonMode: boolean): Promise<string> => {
    throwIfAborted(options.signal);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: buildOpenAiCompatibleHeaders(config.apiKey),
      body: JSON.stringify({
        ...requestPayloadBase,
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: requestSignal.signal,
    });

    rawBody = await response.text();
    let payload: ChatCompletionResponse | undefined;

    if (rawBody.trim()) {
      try {
        payload = JSON.parse(rawBody) as ChatCompletionResponse;
      } catch {
        if (!response.ok) {
          throw new Error(`LLM request failed with status ${response.status}: ${summarizeRawBody(rawBody)}`);
        }

        throw new Error(`LLM response is not valid JSON: ${summarizeRawBody(rawBody)}`);
      }
    }

    if (!response.ok) {
      const message = payload?.error?.message || `LLM request failed with status ${response.status}`;
      const jsonModeUnsupported =
        useJsonMode &&
        config.jsonResponseMode === "auto" &&
        (response.status === 400 || response.status === 404 || response.status === 415 || response.status === 422) &&
        /(response_format|json_object|json mode|unsupported|not support|invalid.*response_format)/i.test(
          `${message} ${rawBody}`,
        );
      if (jsonModeUnsupported) {
        return sendRequest(false);
      }
      throw new Error(message);
    }

    const content = extractChoiceContent(payload?.choices?.[0]);
    if (!content.trim()) {
      const reasoningContent = payload?.choices?.[0]?.message?.reasoning_content?.trim();
      const nullChoicesEnvelope = isNullChoicesEnvelope(payload);
      const jsonModeMayBeSuppressingContent =
        useJsonMode &&
        config.jsonResponseMode === "auto" &&
        (!payload?.choices?.length ||
          (payload?.choices?.[0]?.message && !normalizeChatContent(payload?.choices?.[0]?.message?.content).trim()));

      if (jsonModeMayBeSuppressingContent) {
        return sendRequest(false);
      }

      if (nullChoicesEnvelope) {
        if (!useJsonMode && shouldUseStreamFallback(options)) {
          return collectChatCompletionStream(config, messages, options);
        }
        const detail = rawBody.trim()
          ? ` raw=${JSON.stringify(summarizeRawBody(rawBody))}`
          : "";
        throw new Error(`LLM returned a null choices envelope with zero tokens.${detail}`);
      }

      const detail = reasoningContent
        ? ` reasoning_content=${JSON.stringify(reasoningContent.slice(0, 200))}`
        : rawBody.trim()
          ? ` raw=${JSON.stringify(summarizeRawBody(rawBody))}`
          : "";
      if (!useJsonMode && shouldUseStreamFallback(options)) {
        return collectChatCompletionStream(config, messages, options);
      }
      throw new Error(`LLM returned an empty response.${detail}`);
    }

    return content;
  };

  try {
    return await sendRequest(shouldRequestJsonMode);
  } finally {
    requestSignal.cleanup();
    if (progressTimer) {
      clearInterval(progressTimer);
    }
  }
}

export async function requestChatCompletionStream(
  config: LlmConfig,
  messages: ChatMessage[],
  options: LlmStreamOptions,
): Promise<string> {
  if (!config.apiBaseUrl || !config.apiKey || !config.model) {
    throw new Error("LLM_API_BASE_URL, LLM_API_KEY, and LLM_MODEL must be set.");
  }

  throwIfAborted(options.signal);

  const endpoint = buildChatCompletionsEndpoint(config.apiBaseUrl);
  const startedAt = Date.now();
  let lastDeltaAt = startedAt;
  const progressTimer =
    config.progressIntervalMs > 0
      ? setInterval(() => {
          const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
          const idleSeconds = Math.floor((Date.now() - lastDeltaAt) / 1000);
          console.log(`LLM streaming request still pending after ${elapsedSeconds}s; idle ${idleSeconds}s: ${config.model}`);
        }, config.progressIntervalMs)
      : undefined;

  const idleTimeoutMs = Math.max(0, Math.floor(options.idleTimeoutMs ?? 0));
  const controller = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const abortFromParent = () => controller.abort(options.signal?.reason);
  const armIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    if (idleTimeoutMs > 0) {
      idleTimer = setTimeout(() => {
        controller.abort(new Error(`LLM stream idle timed out after ${idleTimeoutMs}ms without text output.`));
      }, idleTimeoutMs);
    }
  };
  const cleanup = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    options.signal?.removeEventListener("abort", abortFromParent);
    if (progressTimer) {
      clearInterval(progressTimer);
    }
  };

  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }
  armIdleTimer();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: buildOpenAiCompatibleHeaders(config.apiKey),
      body: JSON.stringify({
        ...buildChatCompletionPayload(config, messages, options),
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    cleanup();
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  }

  if (!response.ok) {
    const rawBody = await response.text();
    cleanup();
    let message = `LLM request failed with status ${response.status}`;
    try {
      const payload = JSON.parse(rawBody) as ChatCompletionResponse;
      message = payload.error?.message || message;
    } catch {
      if (rawBody.trim()) {
        message = `${message}: ${summarizeRawBody(rawBody)}`;
      }
    }
    throw new Error(message);
  }

  if (!response.body) {
    cleanup();
    throw new Error("LLM streaming response has no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const handleData = (data: string): void => {
    if (!data || data === "[DONE]") {
      return;
    }
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string | Array<{ type?: string; text?: string }>; reasoning_content?: string };
          message?: { content?: string };
          text?: string;
        }>;
      };
      const choice = payload.choices?.[0];
      if (choice?.delta || choice?.message || choice?.text) {
        lastDeltaAt = Date.now();
        armIdleTimer();
      }
      const delta = normalizeChatContent(choice?.delta?.content) || choice?.message?.content || choice?.text || "";
      if (delta) {
        fullText += delta;
        options.onDelta(delta);
      }
    } catch {
      // Ignore provider keep-alive frames that are not JSON payloads.
    }
  };

  try {
    while (true) {
      throwIfAborted(options.signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        handleData(trimmed.slice(5).trim());
      }
    }
    if (buffer.trim().startsWith("data:")) {
      handleData(buffer.trim().slice(5).trim());
    }
    return fullText;
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof Error) {
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    cleanup();
    reader.releaseLock();
  }
}

export async function requestSceneGraphJsonText(
  config: LlmConfig,
  agentPrompt: string,
  pageContent: string,
  pageNumber: number,
  repairContext?: SceneGraphRepairContext,
  options: LlmRequestOptions = {},
): Promise<string> {
  if (config.mockResponsePath) {
    return requestMockResponse(pageNumber, config.mockResponsePath);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: agentPrompt },
    { role: "user", content: pageContent },
  ];

  if (repairContext) {
    messages.push({
      role: "assistant",
      content: repairContext.previousJsonText,
    });
    messages.push({
      role: "user",
      content: buildValidationRepairMessage(repairContext.validationError, config),
    });
  }

  return requestChatCompletionText(config, messages, options);
}

export async function requestPagePlanJsonText(
  config: LlmConfig,
  plannerPrompt: string,
  pageContent: string,
  options: LlmRequestOptions = {},
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: plannerPrompt },
    { role: "user", content: pageContent },
  ];

  return requestChatCompletionText(config, messages, options);
}

export function extractSceneGraphJson(rawResponse: string): string {
  return extractJsonPayload(rawResponse);
}

export function extractJsonPayloadFromResponse(rawResponse: string): string {
  return extractJsonPayload(rawResponse);
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return;
  }

  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("Operation aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
