import assert from "node:assert/strict";

import {
  INVALID_API_KEY_MESSAGE,
  buildOpenAiCompatibleHeaders,
  getApiKeyValidationError,
  normalizeApiKey,
} from "./llm.ts";

const validKey = "ms-abc_DEF.123~+/=";
assert.equal(getApiKeyValidationError(validKey), undefined);
assert.equal(normalizeApiKey(`  ${validKey}\r\n`), validKey);
assert.equal(buildOpenAiCompatibleHeaders(`  ${validKey}\r\n`).Authorization, `Bearer ${validKey}`);

for (const invalidKey of [
  "业务理解——本项目承载一页结构化正文",
  "key with space",
  "key\nwith-newline",
  "key\twith-tab",
  "key\u0000with-control",
  "clé-non-ascii",
  "????????????????????????????",
  "key?query",
  "key=padding-in-the-middle",
]) {
  assert.equal(getApiKeyValidationError(invalidKey), INVALID_API_KEY_MESSAGE);
  assert.throws(
    () => buildOpenAiCompatibleHeaders(invalidKey),
    (error: unknown) => error instanceof Error
      && error.message === INVALID_API_KEY_MESSAGE
      && !error.message.includes("ByteString"),
  );
}

assert.equal(getApiKeyValidationError("  \r\n"), "请先填写 API Key。");
assert.throws(() => buildOpenAiCompatibleHeaders(""), /请先填写 API Key/);

console.log("LLM_AUTH_SMOKE_OK");
