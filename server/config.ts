import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { type LlmConfigOverrides } from "../llm.ts";
import { DEFAULT_CANVAS_PRESET, type CanvasPreset } from "../types.ts";
import {
  DEFAULT_AGENT_PROMPT_SELECTION,
  isAgentPromptMode,
  isColorStyleKey,
  isLayoutStyleKey,
  type AgentPromptMode,
  type ColorStyleKey,
  type LayoutStyleKey,
} from "../prompt.ts";

export type AppConfig = {
  apiBaseUrl: string;
  model: string;
  apiKey: string;
  pageDelayMs: number;
  outlinePromptPath: string;
  agentPromptPath: string;
  agentPromptMode: AgentPromptMode;
  basePromptPath: string;
  layoutStyle: LayoutStyleKey;
  colorStyle: ColorStyleKey;
  pageGenerationMode: "default" | "singlePageDirect";
  canvasPreset: CanvasPreset;
  maxRetries: number;
  timeoutMs: number;
  outlineStreamIdleTimeoutMs: number;
  temperature: number;
};

const CONFIG_PATH = path.resolve(process.cwd(), "local.config.json");

export const DEFAULT_APP_CONFIG: AppConfig = {
  apiBaseUrl: process.env.LLM_API_BASE_URL ?? "",
  model: process.env.LLM_MODEL ?? "",
  apiKey: process.env.LLM_API_KEY ?? "",
  pageDelayMs: Number(process.env.LLM_PAGE_DELAY_MS ?? 2000),
  outlinePromptPath: "OUTLINE_PROMPT.md",
  agentPromptPath: "AGENT_PROMPT.md",
  agentPromptMode: DEFAULT_AGENT_PROMPT_SELECTION.agentPromptMode,
  basePromptPath: DEFAULT_AGENT_PROMPT_SELECTION.basePromptPath,
  layoutStyle: DEFAULT_AGENT_PROMPT_SELECTION.layoutStyle,
  colorStyle: DEFAULT_AGENT_PROMPT_SELECTION.colorStyle,
  pageGenerationMode: "singlePageDirect",
  canvasPreset: DEFAULT_CANVAS_PRESET,
  maxRetries: Number(process.env.LLM_MAX_RETRIES ?? 1),
  timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 600000),
  outlineStreamIdleTimeoutMs: Number(process.env.LLM_OUTLINE_STREAM_IDLE_TIMEOUT_MS ?? 180000),
  temperature: Number(process.env.LLM_TEMPERATURE ?? 0.2),
};

function normalizeConfig(value: Partial<AppConfig>): AppConfig {
  return {
    apiBaseUrl: value.apiBaseUrl ?? DEFAULT_APP_CONFIG.apiBaseUrl,
    model: value.model ?? DEFAULT_APP_CONFIG.model,
    apiKey: value.apiKey ?? DEFAULT_APP_CONFIG.apiKey,
    pageDelayMs: Number.isFinite(Number(value.pageDelayMs)) ? Math.max(0, Number(value.pageDelayMs)) : DEFAULT_APP_CONFIG.pageDelayMs,
    outlinePromptPath: value.outlinePromptPath ?? DEFAULT_APP_CONFIG.outlinePromptPath,
    agentPromptPath: value.agentPromptPath ?? DEFAULT_APP_CONFIG.agentPromptPath,
    agentPromptMode: isAgentPromptMode(value.agentPromptMode) ? value.agentPromptMode : DEFAULT_APP_CONFIG.agentPromptMode,
    basePromptPath: value.basePromptPath ?? DEFAULT_APP_CONFIG.basePromptPath,
    layoutStyle: isLayoutStyleKey(value.layoutStyle) ? value.layoutStyle : DEFAULT_APP_CONFIG.layoutStyle,
    colorStyle: isColorStyleKey(value.colorStyle) ? value.colorStyle : DEFAULT_APP_CONFIG.colorStyle,
    pageGenerationMode: "singlePageDirect",
    canvasPreset: DEFAULT_CANVAS_PRESET,
    maxRetries: Number.isFinite(Number(value.maxRetries)) ? Math.max(1, Math.floor(Number(value.maxRetries))) : DEFAULT_APP_CONFIG.maxRetries,
    timeoutMs: Number.isFinite(Number(value.timeoutMs)) ? Math.max(0, Math.floor(Number(value.timeoutMs))) : DEFAULT_APP_CONFIG.timeoutMs,
    outlineStreamIdleTimeoutMs: Number.isFinite(Number(value.outlineStreamIdleTimeoutMs))
      ? Math.max(0, Math.floor(Number(value.outlineStreamIdleTimeoutMs)))
      : DEFAULT_APP_CONFIG.outlineStreamIdleTimeoutMs,
    temperature: Number.isFinite(Number(value.temperature)) ? Number(value.temperature) : DEFAULT_APP_CONFIG.temperature,
  };
}

export async function readAppConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return normalizeConfig(JSON.parse(raw) as Partial<AppConfig>);
  } catch {
    return normalizeConfig({});
  }
}

export async function writeAppConfig(config: Partial<AppConfig>): Promise<AppConfig> {
  const normalized = normalizeConfig(config);
  await mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export function toLlmConfigOverrides(config: AppConfig): LlmConfigOverrides {
  return {
    apiBaseUrl: config.apiBaseUrl,
    apiKey: config.apiKey,
    model: config.model,
    pageDelayMs: config.pageDelayMs,
    pageGenerationMode: "singlePageDirect",
    canvasPreset: DEFAULT_CANVAS_PRESET,
    pipelineMode: "single-step",
    enablePagePlan: false,
    enableQualityRetry: false,
    layoutRefinementExtraRetries: 0,
    maxRetries: config.maxRetries,
    timeoutMs: config.timeoutMs,
    temperature: config.temperature,
  };
}
