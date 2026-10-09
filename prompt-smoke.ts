import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";

import { composeAgentPrompt, loadComposedAgentPrompt } from "./prompt.ts";

const composed = composeAgentPrompt({
  basePrompt: "BASE",
  layoutStylePrompt: "LAYOUT",
  colorStylePrompt: "COLOR",
  userCustomPrompt: "CUSTOM",
});

assert.equal(composed, "BASE\n\n---\n\nLAYOUT\n\n---\n\nCOLOR\n\n---\n\nCUSTOM");

const layered = await loadComposedAgentPrompt({
  agentPromptMode: "layered",
  basePromptPath: "prompts/agent-base-pptx-first.md",
  layoutStyle: "finance",
  colorStyle: "tech-blue",
  agentPromptPath: "AGENT_PROMPT.md",
});

assert.equal(layered.promptParts.agentPromptMode, "layered");
assert.ok(layered.prompt.includes("editable 16:9 PPTX"));
assert.ok(layered.prompt.includes("Layout Style: Financial Industry"));
assert.ok(layered.prompt.includes("色调风格：现代科技蓝"));
assert.ok(layered.prompt.includes("不要使用渐变"));
assert.ok(layered.promptPaths.includes("AGENT_PROMPT.md"));

const custom = await loadComposedAgentPrompt({
  agentPromptMode: "custom",
  agentPromptPath: "AGENT_PROMPT.md",
});

assert.deepEqual(custom.promptPaths, ["AGENT_PROMPT.md"]);
assert.equal(custom.promptParts.agentPromptMode, "custom");

const directPrompt = await readFile(new URL("./prompts/agent-single-page-direct.md", import.meta.url), "utf8");
const warmOrangePrompt = await readFile(new URL("./prompts/color-warm-orange.md", import.meta.url), "utf8");
const governmentBluePrompt = await readFile(new URL("./prompts/color-government-blue.md", import.meta.url), "utf8");
const sandGoldPrompt = await readFile(new URL("./prompts/color-sand-gold.md", import.meta.url), "utf8");

assert.ok(!directPrompt.includes("使用 eyebrow 小标签"));
assert.ok(directPrompt.includes("不要为装饰编造输入中不存在的英文眉题"));
assert.ok(directPrompt.includes("右侧没有实际元素时，应延伸到右侧页边距"));
assert.ok(directPrompt.includes('"w": 1152'));
assert.ok(directPrompt.includes("项目内置 icon 素材共 48 枚"));
assert.ok(directPrompt.includes("building、globe、shield"));
assert.ok(directPrompt.includes("banknote、wallet、creditCard"));
assert.ok(directPrompt.includes("shape 只表达几何形状"));
assert.ok(directPrompt.includes("必须显式给出 borderColor 和 borderWidth"));
assert.ok(directPrompt.includes("不要依赖 HTML 阴影表达边界"));
assert.ok(directPrompt.includes("正文 lineHeight 建议 1.30-1.45"));
assert.ok(directPrompt.includes("实际 theme 强调色必须采用本次色调风格"));
assert.ok(!directPrompt.includes("#FF4E26"), "base direct prompt should not bias non-orange styles toward warm orange");
assert.ok(directPrompt.includes('{ "type": "none" }'));
assert.ok(warmOrangePrompt.includes("禁止 #FFF4ED、#FFF7F2 等浅色文字直接落在白底上"));
assert.ok(warmOrangePrompt.includes("#FF4E26"));
assert.ok(warmOrangePrompt.includes("#F86B42"));
assert.ok(warmOrangePrompt.includes("#F27D6C"));
assert.ok(governmentBluePrompt.includes("#145A96"));
assert.ok(governmentBluePrompt.includes("#1E67A8"));
assert.ok(governmentBluePrompt.includes("#2E78B8"));
assert.ok(sandGoldPrompt.includes("#D9B985"));
assert.ok(sandGoldPrompt.includes("#F2C36A"));
assert.ok(sandGoldPrompt.includes("#E8CFA7"));
for (const colorPrompt of [warmOrangePrompt, governmentBluePrompt, sandGoldPrompt]) {
  assert.ok(colorPrompt.includes("不要使用渐变"));
}

for (const colorStyle of ["warm-orange", "government-blue", "sand-gold", "tech-blue"] as const) {
  const loaded = await loadComposedAgentPrompt({
    agentPromptMode: "layered",
    basePromptPath: "prompts/agent-base-pptx-first.md",
    layoutStyle: "consulting",
    colorStyle,
    agentPromptPath: "AGENT_PROMPT.md",
  });
  assert.equal(loaded.promptParts.colorStyle, colorStyle);
  assert.ok(loaded.promptPaths.some((promptPath) => promptPath.includes("color-")));
}

console.log("prompt smoke ok");
