import assert from "node:assert/strict";

import { buildLlmPageContents, parseDoPptCommandMessage } from "./parser.ts";

const denseTwoCardInput = [
  [
    "页标题：约束总览",
    "第一部分内容",
    "页标题: 网点变化",
    "第二部分内容",
    "## 页标题：人员变化",
    "第三部分内容",
    "页标题：财务压力",
    "第四部分内容",
  ].join("\n"),
  "---",
  [
    "页标题：供需错配",
    "第五部分内容",
    "# 外包方案",
    "第六部分内容",
  ].join("\n"),
].join("\n");

const parsed = parseDoPptCommandMessage(denseTwoCardInput);
assert.equal(parsed.pageCount, 2);
assert.deepEqual(parsed.pageTitleIssues, [
  { pageNumber: 1, markerCount: 4 },
  { pageNumber: 2, markerCount: 2 },
]);

const split = parseDoPptCommandMessage(denseTwoCardInput, { splitByTitleMarkers: true });
assert.equal(split.pageCount, 6);
assert.deepEqual(split.pageTitleIssues, []);
const splitContents = buildLlmPageContents(split);
assert.deepEqual(
  splitContents.map((page) => page.split(/\r?\n/)[0]),
  [
    "页标题：约束总览",
    "页标题: 网点变化",
    "## 页标题：人员变化",
    "页标题：财务压力",
    "页标题：供需错配",
    "# 外包方案",
  ],
);
assert(splitContents.every((page) => (page.match(/部分内容/g) ?? []).length === 1));

console.log("PARSER_SMOKE_OK");
