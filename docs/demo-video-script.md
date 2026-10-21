# 演示视频脚本（≤ 3 分钟）

> Nebius x NVIDIA Global AI Hackathon 提交用。目标：180 秒内讲清「Finfold 是什么 →
> Nemotron on Nebius 真实驱动 → 增长闭环 → 人审边界」，全程屏幕录制 + 简短旁白。

## 开录前检查

- [ ] `.env` 已设置 `NEBIUS_API_KEY`，并跑通 `node scripts/verify-nebius.mjs`（三项全绿）
- [ ] 终端里保留 verify 脚本的输出——第 0 幕直接用它当证据
- [ ] 浏览器 zoom 125%，关掉无关标签；用系统录屏（QuickTime / OBS，2560 宽）
- [ ] 旁白稿先读两遍，控制在每幕时间内

## 分镜

| # | 时长 | 画面 | 旁白（要点） |
|---|------|------|--------------|
| 0 | 0:00–0:12 | 终端运行 `node scripts/verify-nebius.mjs`：/models 列出 NVIDIA 模型、Nemotron 对话往返、JSON 往返三行全绿 | "Finfold 的模型层跑在 Nebius Token Factory 上——这是 NVIDIA Nemotron 3 Super 真实应答的验证记录。" |
| 1 | 0:12–0:32 | 首页从主张滑到 CTA 与平台覆盖，与生产站 www.finfold.app 完全一致 | "Finfold 是一位 AI 增长运营员工：发现机会、准备各平台原生稿件、回复评论、记录结果——每一步都经人确认。" |
| 2 | 0:32–1:05 | 工作台：贴入一段产品更新 → 选小红书 + X → 生成两份稿；左下角供应商徽标显示 `nebius · nvidia/nemotron-3-super-120b-a12b`（如界面无此徽标，弹 DevTools Network 里 `api.tokenfactory.nebius.com` 的请求） | "一段更新，两份平台原生稿。生成请求直接打到 Nebius 的 Nemotron——不是演示桩，是生产链路。" |
| 3 | 1:05–1:35 | 品牌记忆页：保存语气/受众/禁用词 → 回到工作台重新生成，措辞变化 | "品牌记忆让它越用越懂你：语气、受众、规则存一次，之后每次生成都带着。" |
| 4 | 1:35–2:05 | 账号诊断：贴一个主页链接 → 报告逐条标出风险表达与证据边界 | "流量变少先查清楚：它区分『可能是风险』和『平台已有证据』，不吓唬人。" |
| 5 | 2:05–2:30 | 结果追踪：发布后的点击/线索回到看板 | "发出去之后，结果自动回流——增长变成一个可复盘的循环。" |
| 6 | 2:30–2:50 | 回到首页标题「增长骇客，为你打工。」定格 | "增长骇客，为你打工。开源在 GitHub，Apache-2.0，Nemotron on Nebius。" |
| 7 | 2:50–3:00 | 黑场白字：repo 链接 + `#NebiusHackathon #Nemotron` | （无旁白，音乐收尾） |

## 剪辑与上传

- 导出 1080p/30fps，≤ 500MB；上传 YouTube 设 Public 或 Unlisted（Devpost 两者都接受）
- 标题建议：`Finfold — an AI growth operator powered by NVIDIA Nemotron on Nebius`
- 描述里放：GitHub 链接、`node scripts/verify-nebius.mjs` 输出截图、一句 "Built for the Nebius x NVIDIA Global AI Hackathon"
