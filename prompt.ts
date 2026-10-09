import { readFile } from "node:fs/promises";
import path from "node:path";

export type AgentPromptMode = "layered" | "custom";
export type LayoutStyleKey = "consulting" | "finance" | "government" | "internet";
export type ColorStyleKey = "warm-orange" | "government-blue" | "sand-gold" | "tech-blue";

export type AgentPromptSelection = {
  agentPromptMode: AgentPromptMode;
  basePromptPath: string;
  layoutStyle: LayoutStyleKey;
  colorStyle: ColorStyleKey;
  agentPromptPath: string;
};

export type PromptOption<T extends string = string> = {
  value: T;
  label: string;
  path?: string;
};

export const DEFAULT_AGENT_BASE_PROMPT_PATH = "prompts/agent-base-pptx-first.md";
export const DEFAULT_AGENT_PROMPT_PATH = "AGENT_PROMPT.md";

export const BASE_PROMPT_OPTIONS: Array<PromptOption<string>> = [
  { value: DEFAULT_AGENT_BASE_PROMPT_PATH, label: "默认通用提示词", path: DEFAULT_AGENT_BASE_PROMPT_PATH },
];

export const LAYOUT_STYLE_PROMPTS: Record<LayoutStyleKey, PromptOption<LayoutStyleKey>> = {
  consulting: { value: "consulting", label: "咨询报告", path: "prompts/layout-consulting.md" },
  finance: { value: "finance", label: "金融行业", path: "prompts/layout-finance.md" },
  government: { value: "government", label: "政府", path: "prompts/layout-government.md" },
  internet: { value: "internet", label: "互联网企业", path: "prompts/layout-internet.md" },
};

export const COLOR_STYLE_PROMPTS: Record<ColorStyleKey, PromptOption<ColorStyleKey>> = {
  "warm-orange": { value: "warm-orange", label: "暖橙 / 橙红", path: "prompts/color-warm-orange.md" },
  "government-blue": { value: "government-blue", label: "政务蓝 / 银行蓝", path: "prompts/color-government-blue.md" },
  "sand-gold": { value: "sand-gold", label: "沙金 / 米金", path: "prompts/color-sand-gold.md" },
  "tech-blue": { value: "tech-blue", label: "现代科技蓝", path: "prompts/color-tech-blue.md" },
};

export const DEFAULT_AGENT_PROMPT_SELECTION: AgentPromptSelection = {
  agentPromptMode: "layered",
  basePromptPath: DEFAULT_AGENT_BASE_PROMPT_PATH,
  layoutStyle: "consulting",
  colorStyle: "warm-orange",
  agentPromptPath: DEFAULT_AGENT_PROMPT_PATH,
};

export function isAgentPromptMode(value: unknown): value is AgentPromptMode {
  return value === "layered" || value === "custom";
}

export function isLayoutStyleKey(value: unknown): value is LayoutStyleKey {
  return typeof value === "string" && value in LAYOUT_STYLE_PROMPTS;
}

export function isColorStyleKey(value: unknown): value is ColorStyleKey {
  return typeof value === "string" && value in COLOR_STYLE_PROMPTS;
}

export async function loadPromptTemplate(fileName: string): Promise<string> {
  const promptPath = path.resolve(process.cwd(), fileName);
  const raw = await readFile(promptPath, "utf8");
  const fencedMatch = raw.match(/```text\s*([\s\S]*?)```/i);
  return (fencedMatch?.[1] ?? raw).trim();
}

export function composeAgentPrompt({
  basePrompt,
  layoutStylePrompt,
  colorStylePrompt,
  userCustomPrompt,
}: {
  basePrompt: string;
  layoutStylePrompt?: string;
  colorStylePrompt?: string;
  userCustomPrompt?: string;
}): string {
  return [
    basePrompt,
    layoutStylePrompt,
    colorStylePrompt,
    userCustomPrompt,
  ]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n---\n\n");
}

export async function loadComposedAgentPrompt(selection: Partial<AgentPromptSelection> = {}): Promise<{
  prompt: string;
  promptParts: AgentPromptSelection;
  promptPaths: string[];
}> {
  const promptParts: AgentPromptSelection = {
    ...DEFAULT_AGENT_PROMPT_SELECTION,
    ...selection,
  };

  if (promptParts.agentPromptMode === "custom") {
    return {
      prompt: await loadPromptTemplate(promptParts.agentPromptPath),
      promptParts,
      promptPaths: [promptParts.agentPromptPath],
    };
  }

  const basePrompt = await loadPromptTemplate(promptParts.basePromptPath);
  const layoutStylePrompt = await loadPromptTemplate(LAYOUT_STYLE_PROMPTS[promptParts.layoutStyle].path ?? "");
  const colorStylePrompt = await loadPromptTemplate(COLOR_STYLE_PROMPTS[promptParts.colorStyle].path ?? "");
  const userCustomPrompt = promptParts.agentPromptPath
    ? await loadPromptTemplate(promptParts.agentPromptPath)
    : "";

  return {
    prompt: composeAgentPrompt({
      basePrompt,
      layoutStylePrompt,
      colorStylePrompt,
      userCustomPrompt,
    }),
    promptParts,
    promptPaths: [
      promptParts.basePromptPath,
      LAYOUT_STYLE_PROMPTS[promptParts.layoutStyle].path ?? "",
      COLOR_STYLE_PROMPTS[promptParts.colorStyle].path ?? "",
      promptParts.agentPromptPath,
    ].filter(Boolean),
  };
}
