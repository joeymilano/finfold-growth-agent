import { describe, expect, it } from "vitest";
import { isDirectCopyRewrite } from "@/lib/agent/request-intent";

describe("self-contained copy rewrites", () => {
  it.each([
    "改写这个：在上海工程技术大学签下一个新的合作。保安室都是全3D打印完成。",
    "Polish this: We signed a new partnership with a university today."
  ])("recognizes supplied text: %s", (text) => expect(isDirectCopyRewrite(text)).toBe(true));

  it.each([
    "改写这个，并搜索最新案例：在上海工程技术大学签下一个新的合作。",
    "改写这个并准备整套方案：在上海工程技术大学签下一个新的合作。",
    "改写后保存草稿：今天我们测试了三款椅子模型，同学们提出了比例调整建议。",
    "改写这个：今天我们测试了三款椅子模型，同学们提出了比例调整建议。然后存入内容库。",
    "帮我改写上次的文案", "改写这个：https://example.com/article",
    "Research and rewrite this: A new university partnership was announced."
  ])("preserves requests needing more than supplied text: %s", (text) => expect(isDirectCopyRewrite(text)).toBe(false));
});

it.each([
  "【QA验收】只改写下面这段文字，给出一个标题和100字以内正文，不需要配图，不要发布，也不要修改已有任务。原文：今天我们测试了三款椅子的纸板模型，让同学们实际坐下、讨论比例，再决定下一轮如何调整。",
  "润色这个：我们今天发布了新版产品，团队记录了反馈并调整了说明。",
  "Polish this, do not publish: Our team tested three cardboard chair models today."
])("does not confuse declined actions or supplied prose with tool requests: %s", text => {
  expect(isDirectCopyRewrite(text)).toBe(true);
});
