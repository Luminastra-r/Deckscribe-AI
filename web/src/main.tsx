import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileText,
  GripVertical,
  KeyRound,
  Loader2,
  PanelRight,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Route,
  Save,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";

import "./styles.css";

type AppConfig = {
  apiBaseUrl: string;
  model: string;
  apiKey: string;
  apiKeySet?: boolean;
  apiKeyIssue?: string;
  pageDelayMs: number;
  outlinePromptPath: string;
  agentPromptPath: string;
  agentPromptMode: "layered" | "custom";
  basePromptPath: string;
  layoutStyle: "consulting" | "finance" | "government" | "internet";
  colorStyle: "warm-orange" | "government-blue" | "sand-gold" | "tech-blue";
  pageGenerationMode: "default" | "singlePageDirect";
  canvasPreset: "legacy_1600x900" | "pptx_16_9_1280x720";
  maxRetries: number;
  timeoutMs: number;
  outlineStreamIdleTimeoutMs: number;
  temperature: number;
};

type PromptOption<T extends string = string> = {
  value: T;
  label: string;
  path?: string;
};

type PromptCategory = "outline" | "agent" | "base" | "layout" | "color" | "other";

type PromptOptions = {
  basePrompts: PromptOption[];
  layoutStyles: PromptOption<AppConfig["layoutStyle"]>[];
  colorStyles: PromptOption<AppConfig["colorStyle"]>[];
};

type PageCard = {
  id: string;
  pageNumber: number;
  content: string;
};

type ChatItem = {
  role: "user" | "assistant";
  content: string;
};

type JobStatus = "running" | "stopping" | "completed" | "failed" | "stopped";

type JobEvent =
  | { type: "started"; pageCount: number; outputDir: string }
  | { type: "page-start"; pageNumber: number; totalPages: number; message: string }
  | { type: "page-complete"; pageNumber: number; totalPages: number; htmlPath: string; jsonPath: string; message: string }
  | { type: "html-complete"; pageCount: number; finalHtmlPath: string; outputDir: string; message: string }
  | { type: "deck-complete"; pageCount: number; finalHtmlPath: string; finalPptxPath: string; outputDir: string; message: string }
  | { type: "failed"; failedPageNumber?: number; outputDir: string; errorMessage: string; partialHtmlPath?: string; message: string }
  | { type: "status"; status: JobStatus; message: string };

type RunRecord = {
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
};

type RunFilter = "all" | "pptx" | "html" | "failed";

const emptyConfig: AppConfig = {
  apiBaseUrl: "",
  model: "",
  apiKey: "",
  pageDelayMs: 2000,
  outlinePromptPath: "OUTLINE_PROMPT.md",
  agentPromptPath: "AGENT_PROMPT.md",
  agentPromptMode: "layered",
  basePromptPath: "prompts/agent-base-pptx-first.md",
  layoutStyle: "consulting",
  colorStyle: "warm-orange",
  pageGenerationMode: "singlePageDirect",
  canvasPreset: "pptx_16_9_1280x720",
  maxRetries: 1,
  timeoutMs: 600000,
  outlineStreamIdleTimeoutMs: 180000,
  temperature: 0.2,
};

const MASKED_API_KEY = "********";
const INVALID_API_KEY_MESSAGE =
  "API Key 配置无效：只能包含 Bearer Token 支持的字母、数字及 -._~+/=，不能包含中文、空白、控制字符或其他正文内容，请重新输入模型服务提供的密钥。";

function getClientApiKeyIssue(config: AppConfig): string {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    return config.apiKeyIssue || "请先填写 API Key";
  }
  if (apiKey === MASKED_API_KEY) {
    return config.apiKeySet ? "" : config.apiKeyIssue || "请先填写 API Key";
  }
  return /^[A-Za-z0-9\-._~+/]+=*$/.test(apiKey) ? "" : INVALID_API_KEY_MESSAGE;
}

const defaultPromptOptions: PromptOptions = {
  basePrompts: [{ value: "prompts/agent-base-pptx-first.md", label: "默认通用提示词" }],
  layoutStyles: [
    { value: "consulting", label: "咨询报告" },
    { value: "finance", label: "金融行业" },
    { value: "government", label: "政府" },
    { value: "internet", label: "互联网企业" },
  ],
  colorStyles: [
    { value: "warm-orange", label: "暖橙 / 橙红" },
    { value: "government-blue", label: "政务蓝 / 银行蓝" },
    { value: "sand-gold", label: "沙金 / 米金" },
    { value: "tech-blue", label: "现代科技蓝" },
  ],
};

const promptCategoryLabels: Record<PromptCategory, string> = {
  outline: "正文编排 Prompt",
  agent: "Agent / 补充 Prompt",
  base: "通用基础 Prompt",
  layout: "排版方案 Prompt",
  color: "配色方案 Prompt",
  other: "其他 Prompt",
};

const promptCategoryOrder: PromptCategory[] = ["outline", "agent", "base", "layout", "color", "other"];

const colorStyleDetails: Record<AppConfig["colorStyle"], { description: string; swatches: string[]; note: string }> = {
  "warm-orange": {
    description: "白底、深灰正文、暖橙强调，商务、锐利、克制。",
    swatches: ["#FFFFFF", "#FFF4ED", "#FF4E26", "#F86B42", "#F27D6C", "#172033"],
    note: "暖橙用于标题强调、粗线条、关键编号、核心结论框和流程主线。",
  },
  "government-blue": {
    description: "白底、深灰正文、政务蓝强调，稳重、可信、专业。",
    swatches: ["#FFFFFF", "#F3F7FB", "#145A96", "#1E67A8", "#2E78B8", "#172033"],
    note: "深蓝用于标题和核心结构，商务蓝用于重点框，浅商务蓝用于节点和辅助信息。",
  },
  "sand-gold": {
    description: "白底、深灰正文、沙金强调，温润、稳健、精致。",
    swatches: ["#FFFFFF", "#FCF8F1", "#D9B985", "#F2C36A", "#E8CFA7", "#172033"],
    note: "金色用于大字号数字、重点线条和承载色块，不用于白底小字号正文。",
  },
  "tech-blue": {
    description: "白底、蓝灰正文、科技蓝强调，清爽、理性、专业。",
    swatches: ["#FFFFFF", "#EFF6FF", "#2563EB", "#1E3A8A", "#0891B2", "#1E293B"],
    note: "主蓝用于标题强调、关键数字、流程节点、结构线和重点框。",
  },
};

function promptCategory(pathValue: string): PromptCategory {
  const normalized = pathValue.replace(/\\/g, "/").toLowerCase();
  const fileName = normalized.split("/").at(-1) ?? normalized;
  if (fileName.includes("outline")) return "outline";
  if (normalized.includes("/color-") || fileName.startsWith("color-")) return "color";
  if (normalized.includes("/layout-") || fileName.startsWith("layout-")) return "layout";
  if (fileName.includes("agent-base")) return "base";
  if (fileName.includes("agent")) return "agent";
  return "other";
}

function promptOptionLabel(pathValue: string): string {
  return `${pathValue} · ${promptCategoryLabels[promptCategory(pathValue)]}`;
}

function groupedPromptOptions(promptPaths: string[], currentPath: string): Array<{ category: PromptCategory; paths: string[] }> {
  const uniquePaths = Array.from(new Set([...promptPaths, currentPath].filter(Boolean)));
  return promptCategoryOrder
    .map((category) => ({
      category,
      paths: uniquePaths.filter((pathValue) => promptCategory(pathValue) === category),
    }))
    .filter((group) => group.paths.length > 0);
}

function apiBase(): string {
  return window.location.port === "5173" ? "http://127.0.0.1:4172" : "";
}

function apiUrl(path: string): string {
  return `${apiBase()}${path}`;
}

function describeFetchError(error: unknown): Error {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new Error(`无法连接本地 API 服务。请确认 npm run dev 正在运行，当前页面地址是 ${window.location.origin}。`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    headers[key] = value;
  });
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(url), { ...init, headers });
  } catch (error) {
    throw describeFetchError(error);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? payload.message ?? `Request failed: ${response.status}`);
  }
  return payload as T;
}

async function readOutlineStream(
  body: unknown,
  onDelta: (delta: string) => void,
  onStatus: (message: string) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/outline/chat/stream"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw describeFetchError(error);
  }

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  const handleEvent = (raw: string): void => {
    const dataLines = raw.split(/\r?\n/).filter((line) => line.startsWith("data:"));
    for (const line of dataLines) {
      const payload = JSON.parse(line.slice(5).trim()) as {
        type: "delta" | "done" | "error" | "status";
        delta?: string;
        error?: string;
        message?: string;
      };
      if (payload.type === "error") {
        throw new Error(payload.error ?? "LLM stream failed.");
      }
      if (payload.type === "status" && payload.message) {
        onStatus(payload.message);
      }
      if (payload.type === "delta" && payload.delta) {
        fullText += payload.delta;
        onDelta(payload.delta);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\n\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      if (event.trim()) {
        handleEvent(event);
      }
    }
  }

  if (buffer.trim()) {
    handleEvent(buffer);
  }
  return fullText;
}

function joinPages(pages: PageCard[]): string {
  return pages.map((page) => page.content.trim()).filter(Boolean).join("\n---\n");
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function countPageTitleMarkers(text: string): number {
  return text.split(/\r?\n/).filter((line) => /^(?:页标题\s*[:：]\s*\S|#{1,6}\s+(?:页标题\s*[:：]\s*)?\S)/.test(line.trim())).length;
}

function displayFileName(pathValue: string): string {
  return pathValue.split(/[\\/]/).filter(Boolean).at(-1) ?? pathValue;
}

function getRunKind(run: RunRecord): RunFilter {
  if (run.finalPptxPath) return "pptx";
  if (run.failedAt) return "failed";
  if (run.finalHtmlPath) return "html";
  return "all";
}

function statusCopy(busy: string, finalPptxPath: string): string {
  if (busy === "chat") return "正文生成中";
  if (busy === "parse") return "正文识别中";
  if (busy === "generate") return "PPTX 生成中";
  if (busy === "test") return "连接测试中";
  if (finalPptxPath) return "PPTX 已生成";
  return "准备就绪";
}

function fileLink(pathValue: string): string {
  return apiUrl(`/api/files?path=${encodeURIComponent(pathValue)}`);
}

function App() {
  const [config, setConfig] = useState<AppConfig>(emptyConfig);
  const [prompts, setPrompts] = useState<string[]>(["OUTLINE_PROMPT.md", "AGENT_PROMPT.md"]);
  const [promptOptions, setPromptOptions] = useState<PromptOptions>(defaultPromptOptions);
  const [activeTab, setActiveTab] = useState<"chat" | "pages" | "settings">("chat");
  const [background, setBackground] = useState("");
  const [outlineText, setOutlineText] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [pages, setPages] = useState<PageCard[]>([]);
  const [busy, setBusy] = useState<"" | "chat" | "parse" | "generate" | "test" | "save">("");
  const [message, setMessage] = useState("");
  const [jobId, setJobId] = useState("");
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [finalHtmlPath, setFinalHtmlPath] = useState("");
  const [finalPptxPath, setFinalPptxPath] = useState("");
  const [partialHtmlPath, setPartialHtmlPath] = useState("");
  const [failedPageNumber, setFailedPageNumber] = useState<number | undefined>();
  const [runError, setRunError] = useState("");
  const [draggedPageId, setDraggedPageId] = useState("");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [runFilter, setRunFilter] = useState<RunFilter>("all");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const completedPages = events.filter((event) => event.type === "page-complete").length;
  const totalPages = pages.length;
  const progress = totalPages ? Math.round((completedPages / totalPages) * 100) : 0;
  const pageSourceText = outlineText || joinPages(pages);
  const isLlmBusy = busy === "chat" || busy === "generate" || busy === "test";

  const latestEvent = useMemo(() => {
    const event = events.at(-1);
    return event && "message" in event ? event.message : statusCopy(busy, finalPptxPath);
  }, [busy, events, finalPptxPath]);

  const configIssue = useMemo(() => {
    if (!config.apiBaseUrl.trim()) return "请先填写 Base URL";
    if (!config.model.trim()) return "请先填写 Model ID";
    return getClientApiKeyIssue(config);
  }, [config]);

  const pagesIssue = useMemo(() => {
    if (pages.length === 0) return "请先识别或添加至少 1 页正文";
    if (pages.length > 20) return "一次最多生成 20 页";
    const markerIssue = pages
      .map((page, index) => ({ pageNumber: index + 1, markerCount: countPageTitleMarkers(page.content) }))
      .find((issue) => issue.markerCount > 1);
    if (markerIssue) return `第 ${markerIssue.pageNumber} 页检测到 ${markerIssue.markerCount} 个页标题，建议拆分`;
    const emptyIndex = pages.findIndex((page) => !page.content.trim());
    if (emptyIndex >= 0) return `第 ${emptyIndex + 1} 页为空`;
    const titlelessIndex = pages.findIndex((page) => !firstLine(page.content));
    if (titlelessIndex >= 0) return `第 ${titlelessIndex + 1} 页缺少标题`;
    return "";
  }, [pages]);

  const generateBlocker = configIssue || pagesIssue || (isLlmBusy ? "LLM 任务运行中" : "");
  const canGenerate = !generateBlocker && !busy;
  const pageTitleIssues = useMemo(() => pages
    .map((page, index) => ({ pageNumber: index + 1, markerCount: countPageTitleMarkers(page.content) }))
    .filter((issue) => issue.markerCount > 1), [pages]);

  const steps = [
    { key: "config", label: "配置", done: !configIssue, active: activeTab === "settings" },
    { key: "outline", label: "正文", done: Boolean(outlineText.trim() || pages.length), active: activeTab === "chat" },
    { key: "pages", label: "分页", done: pages.length > 0 && !pagesIssue, active: activeTab === "pages" && !finalPptxPath },
    { key: "pptx", label: "PPTX 导出", done: Boolean(finalPptxPath), active: busy === "generate" },
  ];

  const filteredRuns = useMemo(() => {
    return runs.filter((run) => runFilter === "all" || getRunKind(run) === runFilter);
  }, [runFilter, runs]);
  const selectedColorStyle = promptOptions.colorStyles.find((option) => option.value === config.colorStyle);

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const payload = await requestJson<{ config: AppConfig; prompts: string[]; promptOptions?: PromptOptions; runs: RunRecord[] }>("/api/config");
      setConfig(payload.config);
      setPrompts(payload.prompts);
      setPromptOptions(payload.promptOptions ?? defaultPromptOptions);
      setRuns(payload.runs ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadRuns() {
    const payload = await requestJson<{ runs: RunRecord[] }>("/api/deck/runs");
    setRuns(payload.runs);
  }

  async function saveConfig() {
    setBusy("save");
    setMessage("");
    try {
      const payload = await requestJson<{ config: AppConfig }>("/api/config", {
        method: "PUT",
        body: JSON.stringify(config),
      });
      setConfig(payload.config);
      setMessage("配置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function testConfig() {
    setBusy("test");
    setMessage("");
    try {
      const payload = await requestJson<{ ok: boolean; latencyMs: number }>("/api/config/test", {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(`LLM 连接正常，耗时 ${payload.latencyMs}ms。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function generateOutline() {
    if (!background.trim()) {
      setMessage("请先输入背景信息。");
      return;
    }
    if (configIssue) {
      setMessage(configIssue);
      setActiveTab("settings");
      return;
    }

    setBusy("chat");
    setMessage("");
    const nextChat: ChatItem[] = [...chat, { role: "user", content: background }];
    setChat(nextChat);
    setOutlineText("");

    try {
      let streamed = "";
      const content = await readOutlineStream(
        {
          background,
          messages: chat.map((item) => ({ role: item.role, content: item.content })),
        },
        (delta) => {
          streamed += delta;
          setOutlineText(streamed);
        },
        (status) => setMessage(status),
      );
      setOutlineText(content);
      setChat([...nextChat, { role: "assistant", content }]);
      setBackground("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function parseOutline(text = outlineText, splitByTitleMarkers = false) {
    setBusy("parse");
    setMessage("");
    try {
      const payload = await requestJson<{ pageCount: number; pages: PageCard[]; pageTitleIssues?: Array<{ pageNumber: number; markerCount: number }> }>("/api/pages/parse", {
        method: "POST",
        body: JSON.stringify({ text, splitByTitleMarkers }),
      });
      setPages(payload.pages);
      setOutlineText(payload.pages.map((page) => page.content).join("\n---\n"));
      setActiveTab("pages");
      setMessage(splitByTitleMarkers
        ? `已按页标题拆分为 ${payload.pageCount} 页。`
        : payload.pageTitleIssues?.length
          ? `已识别 ${payload.pageCount} 页，检测到分页冲突，请先拆分。`
          : `已识别 ${payload.pageCount} 页。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function reorderPages(fromIndex: number, toIndex: number) {
    const next = [...pages];
    const [moved] = next.splice(fromIndex, 1);
    if (!moved) return;
    next.splice(toIndex, 0, moved);
    const numbered = next.map((page, pageIndex) => ({ ...page, pageNumber: pageIndex + 1 }));
    setPages(numbered);
    setOutlineText(numbered.map((page) => page.content).join("\n---\n"));
  }

  function movePage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    reorderPages(index, target);
  }

  function updatePage(index: number, content: string) {
    const next = pages.map((page, pageIndex) => pageIndex === index ? { ...page, content } : page);
    setPages(next);
    setOutlineText(next.map((page) => page.content).join("\n---\n"));
  }

  function removePage(index: number) {
    const next = pages
      .filter((_, pageIndex) => pageIndex !== index)
      .map((page, pageIndex) => ({ ...page, pageNumber: pageIndex + 1 }));
    setPages(next);
    setOutlineText(next.map((page) => page.content).join("\n---\n"));
  }

  function addPage() {
    const next = [
      ...pages,
      {
        id: `page-${Date.now()}`,
        pageNumber: pages.length + 1,
        content: "新页面标题\n补充正文",
      },
    ];
    setPages(next);
    setOutlineText(next.map((page) => page.content).join("\n---\n"));
  }

  function handleDrop(targetId: string) {
    if (!draggedPageId || draggedPageId === targetId) {
      setDraggedPageId("");
      return;
    }
    const fromIndex = pages.findIndex((page) => page.id === draggedPageId);
    const toIndex = pages.findIndex((page) => page.id === targetId);
    if (fromIndex >= 0 && toIndex >= 0) {
      reorderPages(fromIndex, toIndex);
    }
    setDraggedPageId("");
  }

  async function generatePptx(forceFresh = false) {
    if (generateBlocker) {
      setMessage(generateBlocker);
      if (configIssue) setActiveTab("settings");
      return;
    }

    const resumeOutputDir = !forceFresh && outputDir && !finalPptxPath ? outputDir : "";
    setBusy("generate");
    setMessage("");
    setEvents([]);
    setFinalHtmlPath("");
    setFinalPptxPath("");
    setPartialHtmlPath("");
    setFailedPageNumber(undefined);
    setRunError("");

    try {
      const payload = await requestJson<{ jobId: string }>("/api/deck/generate", {
        method: "POST",
        body: JSON.stringify({
          deckName: "deckscribe-ai-workbench",
          pages,
          outputDir: resumeOutputDir || undefined,
        }),
      });
      setJobId(payload.jobId);
      const source = new EventSource(apiUrl(`/api/jobs/${payload.jobId}/events`));
      source.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as JobEvent;
        setEvents((current) => [...current, parsed]);
        if ("outputDir" in parsed && parsed.outputDir) {
          setOutputDir(parsed.outputDir);
        }
        if (parsed.type === "html-complete") {
          setFinalHtmlPath(parsed.finalHtmlPath);
          setPartialHtmlPath("");
        }
        if (parsed.type === "deck-complete") {
          setFinalHtmlPath(parsed.finalHtmlPath);
          setFinalPptxPath(parsed.finalPptxPath);
          setPartialHtmlPath("");
          setRunError("");
        }
        if (parsed.type === "failed") {
          setFailedPageNumber(parsed.failedPageNumber);
          setRunError(parsed.errorMessage);
          setPartialHtmlPath(parsed.partialHtmlPath ?? "");
          source.close();
          setBusy("");
          void loadRuns();
        }
        if (parsed.type === "status" && parsed.status !== "running" && parsed.status !== "stopping") {
          if (parsed.status === "failed" || parsed.status === "stopped") {
            setRunError(parsed.message);
          }
          source.close();
          setBusy("");
          void loadRuns();
        }
      };
      source.onerror = () => {
        source.close();
        setBusy("");
        setMessage("生成事件连接已中断。可从当前生成记录继续，或重新生成。");
      };
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      setBusy("");
    }
  }

  async function stopJob() {
    if (!jobId) return;
    try {
      const payload = await requestJson<{ ok: boolean; status: JobStatus }>(`/api/jobs/${jobId}/stop`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setMessage(payload.status === "stopping" ? "正在停止生成任务..." : `任务状态：${payload.status}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function restoreRun(run: RunRecord) {
    try {
      const detail = await requestJson<{
        outputDir: string;
        pages: string[];
        finalHtmlPath?: string;
        finalPptxPath?: string;
        partialHtmlPath?: string;
        failedPageNumber?: number;
        errorMessage?: string;
      }>(`/api/deck/runs/${encodeURIComponent(run.id)}`);
      setOutputDir(detail.outputDir);
      setFinalHtmlPath(detail.finalHtmlPath ?? "");
      setFinalPptxPath(detail.finalPptxPath ?? "");
      setPartialHtmlPath(detail.partialHtmlPath ?? "");
      setFailedPageNumber(detail.failedPageNumber);
      setRunError(detail.errorMessage ?? "");
      setPages(detail.pages.map((content, index) => ({
        id: `page-${index + 1}-${Date.now()}`,
        pageNumber: index + 1,
        content,
      })));
      setOutlineText(detail.pages.join("\n---\n"));
      setEvents([]);
      setMessage(`已加载生成记录：${run.id}`);
      setActiveTab("pages");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function deleteRun(run: RunRecord, event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const confirmed = window.confirm(`删除这条生成记录？\n${run.id}`);
    if (!confirmed) return;
    setMessage("");
    try {
      const payload = await requestJson<{ runs: RunRecord[] }>(`/api/deck/runs/${encodeURIComponent(run.id)}`, {
        method: "DELETE",
      });
      setRuns(payload.runs);
      if (outputDir === run.outputDir) {
        setOutputDir("");
        setFinalHtmlPath("");
        setFinalPptxPath("");
        setPartialHtmlPath("");
        setFailedPageNumber(undefined);
        setRunError("");
      }
      setMessage("生成记录已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/deckscribe-ai-logo.png" alt="Deckscribe-AI logo" />
          </div>
          <div>
            <h1>Deckscribe-AI</h1>
            <p>Presentation operations desk</p>
          </div>
        </div>

        <nav className="nav-stack" aria-label="主导航">
          <button className={activeTab === "chat" ? "active" : ""} onClick={() => setActiveTab("chat")}>
            <Bot size={18} /> 对话编排
          </button>
          <button className={activeTab === "pages" ? "active" : ""} onClick={() => setActiveTab("pages")}>
            <FileText size={18} /> 分页生成
          </button>
          <button className={activeTab === "settings" ? "active" : ""} onClick={() => setActiveTab("settings")}>
            <Settings size={18} /> 模型配置
          </button>
        </nav>

        <section className="run-panel" aria-label="生成进度">
          <div className="ribbon-label">Deck Progress</div>
          <div className="run-number">{completedPages}<span>/{totalPages || 0}</span></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <p>{latestEvent}</p>
        </section>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="title-block">
            <span className="eyebrow"><Sparkles size={14} /> Workflow</span>
            <strong>{activeTab === "chat" ? "正文编排" : activeTab === "pages" ? "分页与生成工作台" : "OpenAI-compatible 配置"}</strong>
            <span>{statusCopy(busy, finalPptxPath)}</span>
          </div>
          <div className="top-actions">
            <span className="status-pill">{config.model || "未配置模型"}</span>
            {busy === "generate" ? (
              <button className="danger" onClick={stopJob}><Square size={16} /> 停止</button>
            ) : null}
          </div>
        </header>

        <section className="stepper" aria-label="工作流步骤">
          {steps.map((step, index) => (
            <button
              key={step.key}
              className={`step ${step.done ? "done" : ""} ${step.active ? "active" : ""}`}
              onClick={() => {
                if (step.key === "config") setActiveTab("settings");
                if (step.key === "outline") setActiveTab("chat");
                if (step.key === "pages" || step.key === "pptx") setActiveTab("pages");
              }}
            >
              <span>{step.done ? <CheckCircle2 size={15} /> : index + 1}</span>
              {step.label}
            </button>
          ))}
        </section>

        {message ? <div className="notice">{message}</div> : null}

        {activeTab === "chat" ? (
          <section className="two-column">
            <div className="panel stretch">
              <div className="panel-head">
                <span><Route size={16} /> 背景输入</span>
                <em>{configIssue || "streaming"}</em>
              </div>
              <label className="field-label" htmlFor="background-input">背景、目标和材料要点</label>
              <textarea
                id="background-input"
                value={background}
                onChange={(event) => setBackground(event.target.value)}
                placeholder="输入客户背景、目标、材料要点或你希望 PPT 覆盖的信息"
              />
              <div className="toolbar">
                <button className="primary-action" disabled={Boolean(isLlmBusy)} onClick={generateOutline}>
                  {busy === "chat" ? <Loader2 className="spin" size={16} /> : <Wand2 size={16} />} 生成 PPT 正文
                </button>
                <span className="soft-note">{configIssue || "输出会实时流入右侧正文框。"}</span>
              </div>
            </div>

            <div className="panel stretch output-draft">
              <div className="panel-head">
                <span><PanelRight size={16} /> 输出正文</span>
                <em>{outlineText ? `${outlineText.length} 字符` : "等待生成"}</em>
              </div>
              <label className="field-label" htmlFor="outline-output">可编辑正文</label>
              <textarea id="outline-output" value={outlineText} onChange={(event) => setOutlineText(event.target.value)} />
              <div className="toolbar">
                <button disabled={!outlineText.trim() || busy === "parse"} onClick={() => parseOutline()}>
                  <Plus size={16} /> 加入分页
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "pages" ? (
          <section className="pages-layout">
            <div className="panel page-source">
              <div className="panel-head">
                <span><FileText size={16} /> 分页文本</span>
                <em>--- 分隔</em>
              </div>
              <label className="field-label" htmlFor="page-source">原始分页正文</label>
              <textarea id="page-source" value={pageSourceText} onChange={(event) => setOutlineText(event.target.value)} />
              <div className="toolbar">
                <button onClick={() => parseOutline(pageSourceText)}><RefreshCw size={16} /> 重新识别</button>
                <button onClick={addPage}><Plus size={16} /> 添加页</button>
              </div>
              {pageTitleIssues.length ? (
                <div className="pagination-warning" role="alert">
                  <span><AlertTriangle size={16} /> {pageTitleIssues.map((issue) => `第 ${issue.pageNumber} 页检测到 ${issue.markerCount} 个页标题`).join("；")}，建议拆分。</span>
                  <button onClick={() => parseOutline(joinPages(pages), true)}>一键按页标题拆分</button>
                </div>
              ) : null}
            </div>

            <div className="page-list" aria-label="页面列表">
              {pages.length === 0 ? (
                <div className="empty-state">
                  <Sparkles size={22} />
                  <strong>还没有分页正文</strong>
                  <span>从对话页生成，或在左侧粘贴用 --- 分隔的正文。</span>
                </div>
              ) : null}

              {pages.map((page, index) => (
                <article
                  className={`page-card ${failedPageNumber === page.pageNumber ? "failed" : ""} ${draggedPageId === page.id ? "dragging" : ""}`}
                  draggable
                  key={page.id}
                  onDragStart={() => setDraggedPageId(page.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(page.id)}
                  onDragEnd={() => setDraggedPageId("")}
                >
                  <div className="page-card-head">
                    <div className="page-index">
                      <GripVertical size={16} aria-hidden="true" />
                      <strong>第 {page.pageNumber} 页</strong>
                    </div>
                    <div className="icon-row">
                      <button className="icon" onClick={() => movePage(index, -1)} title="上移" aria-label={`上移第 ${page.pageNumber} 页`}><ArrowUp size={15} /></button>
                      <button className="icon" onClick={() => movePage(index, 1)} title="下移" aria-label={`下移第 ${page.pageNumber} 页`}><ArrowDown size={15} /></button>
                      <button className="icon danger-icon" onClick={() => removePage(index)} title="删除" aria-label={`删除第 ${page.pageNumber} 页`}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <label className="field-label" htmlFor={`page-${page.id}`}>第 {page.pageNumber} 页正文</label>
                  <textarea id={`page-${page.id}`} value={page.content} onChange={(event) => updatePage(index, event.target.value)} />
                </article>
              ))}
            </div>

            <div className="panel output-panel">
              <div className="panel-head">
                <span><Download size={16} /> 生成与导出</span>
                <em>{busy === "generate" ? "生成中" : `${progress}%`}</em>
              </div>
              {busy === "generate" ? (
                <div className="tech-loader" aria-label="生成中">
                  <span />
                  <strong>{latestEvent}</strong>
                </div>
              ) : null}
              {runError ? (
                <div className="error-box">
                  <AlertTriangle size={16} />
                  <span>{failedPageNumber ? `第 ${failedPageNumber} 页失败：` : ""}{runError}</span>
                </div>
              ) : null}
              <button className="primary-action" disabled={!canGenerate} onClick={() => generatePptx(false)}>
                {busy === "generate" ? <Loader2 className="spin" size={16} /> : <Play size={16} />} {outputDir && !finalPptxPath ? "从失败处继续导出" : "PPTX 导出"}
              </button>
              <button disabled={!canGenerate} onClick={() => generatePptx(true)}>
                <RotateCcw size={16} /> 重新生成 PPTX
              </button>
              <span className="soft-note">{generateBlocker || (finalPptxPath ? "PPTX 已生成，可下载或在线预览。" : "生成完成前会检查每页结构与内容完整性。")}</span>
              {finalPptxPath || partialHtmlPath ? (
                <div className="result-actions" aria-live="polite">
                  {finalPptxPath ? (
                    <div className="result-card success">
                      <span>
                        <CheckCircle2 size={18} />
                        <span className="result-copy">
                          <strong>PPTX 已生成</strong>
                          <small title={displayFileName(finalPptxPath)}>{displayFileName(finalPptxPath)}</small>
                        </span>
                      </span>
                      <div className="result-card-actions">
                        <a className="result-cta" href={fileLink(finalPptxPath)}><Download size={16} /> 下载 PPTX</a>
                        {finalHtmlPath ? (
                          <a className="result-cta secondary" href={fileLink(finalHtmlPath)} target="_blank" rel="noreferrer"><ExternalLink size={16} /> 在线预览</a>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  {partialHtmlPath ? (
                    <div className="result-card warning">
                      <span>
                        <AlertTriangle size={18} />
                        <span className="result-copy">
                          <strong>生成未完成</strong>
                          <small>已保留内部诊断信息，请根据上方原因修正后重试。</small>
                        </span>
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="event-log">
                {events.slice(-10).map((event, index) => (
                  <p key={`${event.type}-${index}`}>{"message" in event ? event.message : event.type}</p>
                ))}
              </div>
              <div className="run-history">
                <div className="panel-head compact-head">
                  <span>生成记录</span>
                  <em>{filteredRuns.length}/{runs.length}</em>
                </div>
                <div className="segmented" aria-label="历史记录筛选">
                  {(["all", "pptx", "failed"] as const).map((filter) => (
                    <button key={filter} className={runFilter === filter ? "active" : ""} onClick={() => setRunFilter(filter)}>
                      {filter === "all" ? "全部" : filter === "pptx" ? "PPTX" : "失败"}
                    </button>
                  ))}
                </div>
                <div className={filteredRuns.length > 8 ? "run-list scrollable" : "run-list"}>
                  {filteredRuns.map((run) => {
                    const kind = getRunKind(run);
                    return (
                      <div
                        className="run-item"
                        key={run.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => void restoreRun(run)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            void restoreRun(run);
                          }
                        }}
                      >
                        <span className="run-main">
                          <strong>{new Date(run.startedAt).toLocaleString()}</strong>
                          <span>{run.pageCount} 页 · {run.model || "unknown model"}</span>
                          {run.errorMessage ? <small>{run.errorMessage}</small> : null}
                        </span>
                        <span className={`run-badge ${kind}`}>{kind === "pptx" ? "PPTX" : kind === "html" ? "未完成" : kind === "failed" ? "失败" : "生成中"}</span>
                        <button className="run-delete" type="button" onClick={(event) => deleteRun(run, event)} title="删除生成记录" aria-label="删除生成记录">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {activeTab === "settings" ? (
          <section className="settings-grid">
            <div className="settings-section">
              <div className="panel-head compact-head">
                <span><KeyRound size={16} /> 连接配置</span>
                <em>{configIssue || "ready"}</em>
              </div>
              <label>Base URL<input placeholder="https://api-inference.modelscope.cn/v1" value={config.apiBaseUrl} onChange={(event) => setConfig({ ...config, apiBaseUrl: event.target.value })} /></label>
              <label>Model ID<input placeholder="例如 deepseek-ai/DeepSeek-V4-Pro" value={config.model} onChange={(event) => setConfig({ ...config, model: event.target.value })} /></label>
              <label>API Key<input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={config.apiKey}
                onChange={(event) => setConfig({
                  ...config,
                  apiKey: event.target.value,
                  apiKeySet: false,
                  apiKeyIssue: undefined,
                })}
              /></label>
            </div>

            <div className="settings-section">
              <div className="panel-head compact-head">
                <span><FileText size={16} /> 生成风格</span>
                <em>PPTX-first</em>
              </div>
              <p className="choice-note">固定使用低阶 primitive 单页直排路径，内部画布 1280×720，导出 PPTX 13.333×7.5in。HTML 仅用于在线预览和质量检查。</p>
              <div className="prompt-choice-group">
                <span className="field-label">色调风格</span>
                <div className="color-option-grid">
                  {promptOptions.colorStyles.map((option) => {
                    const details = colorStyleDetails[option.value];
                    return (
                      <button
                        key={option.value}
                        className={config.colorStyle === option.value ? "color-option active" : "color-option"}
                        type="button"
                        aria-pressed={config.colorStyle === option.value}
                        onClick={() => setConfig({ ...config, colorStyle: option.value })}
                      >
                        <span className="swatches" aria-hidden="true">
                          {details.swatches.map((color) => <i key={color} style={{ background: color }} />)}
                        </span>
                        <strong>{option.label}</strong>
                        <small>{details.description}</small>
                      </button>
                    );
                  })}
                </div>
                <p className="choice-note">当前色调：{selectedColorStyle?.label ?? config.colorStyle}。{colorStyleDetails[config.colorStyle].note}</p>
              </div>
            </div>

            <div className="settings-section full-span">
              <button className="section-toggle" type="button" onClick={() => setShowAdvanced((value) => !value)}>
                <SlidersHorizontal size={16} /> 生成参数 <span>{showAdvanced ? "收起" : "展开"}</span>
              </button>
              {showAdvanced ? (
                <div className="advanced-grid">
                  <label>页间隔 ms<input type="number" min="0" step="500" value={config.pageDelayMs} onChange={(event) => setConfig({ ...config, pageDelayMs: Number(event.target.value) })} /></label>
                  <label>LLM 总超时 ms<input type="number" min="0" step="1000" value={config.timeoutMs} onChange={(event) => setConfig({ ...config, timeoutMs: Number(event.target.value) })} /></label>
                  <label>对话空闲超时 ms<input type="number" min="0" step="1000" value={config.outlineStreamIdleTimeoutMs} onChange={(event) => setConfig({ ...config, outlineStreamIdleTimeoutMs: Number(event.target.value) })} /></label>
                  <label>最大重试<input type="number" min="1" value={config.maxRetries} onChange={(event) => setConfig({ ...config, maxRetries: Number(event.target.value) })} /></label>
                  <label>温度<input type="number" step="0.1" value={config.temperature} onChange={(event) => setConfig({ ...config, temperature: Number(event.target.value) })} /></label>
                </div>
              ) : null}
            </div>

            <div className="settings-actions">
              <button className="primary-action" disabled={busy === "save"} onClick={saveConfig}><Save size={16} /> 保存配置</button>
              <button disabled={busy === "test" || Boolean(configIssue)} onClick={testConfig}>{busy === "test" ? <Loader2 className="spin" size={16} /> : <KeyRound size={16} />} 测试 LLM</button>
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
