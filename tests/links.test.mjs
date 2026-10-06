import assert from "node:assert/strict";
import test from "node:test";

import { executionPagePath, forumPostPagePath, qdashObjectLinks } from "../.test-dist/lib/links.js";

const client = { config: { baseUrl: "https://qdash.example/api" } };

test("object links use the QDash web routes", () => {
  const links = qdashObjectLinks(client, {
    task_id: "t 1",
    execution_id: "20261006-012",
    chip_id: "64Qv3",
    post_id: "p1",
  });
  assert.deepEqual(links, {
    task_result: "https://qdash.example/task-results/t%201",
    execution: "https://qdash.example/execution/64Qv3/20261006-012",
    forum_post: "https://qdash.example/forum/p1",
  });
});

test("an execution without a known chip uses the id-only route that redirects", () => {
  assert.equal(executionPagePath("20261006-012"), "/executions/20261006-012");
  assert.equal(executionPagePath("20261006-012", null), "/executions/20261006-012");
  assert.equal(forumPostPagePath("a/b"), "/forum/a%2Fb");
  assert.equal(qdashObjectLinks(client, { execution_id: "x" }).execution, "https://qdash.example/executions/x");
});
