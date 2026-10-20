# Finfold 微信小程序「增长搭子」

AI 推荐选题 → 用户选定 → 准备带 AI 标识的草稿 → 复制或分享公开选题。

## 当前状态（2026-10-11）

已完成本地修复与回归验证；尚未注册正式小程序、尚未创建云开发环境，不能视为真机可用或已上线。
公众号第三方平台「Finfold 内容助手」的申请是独立流程，其 AppID 不能填入本小程序项目。
当前仍保留游客 AppID 与云环境占位值，上传检查会阻止误传。大赛资格和截止时间须以赛事平台当前规则核验。

## 注册及部署顺序

1. 在微信公众平台注册企业小程序，使用真实运营主体，完成后台要求的身份核验、备案与实际功能对应的服务类目。
2. 取得该小程序的 AppID，在微信开发者工具导入本目录，为该 AppID 创建并关联云开发环境。开通涉及费用时先确认实际套餐与预算。
3. 在本目录执行 `node scripts/configure.mjs --appid <小程序AppID> --cloud-env <云开发环境ID>`。它同步主包和 AI 独立分包的环境配置，不需要 AppSecret。
4. 执行 `node scripts/check-config.mjs`、`npm run typecheck`。
5. 在服务端数据库按序应用 `supabase/migrations/123_weapp.sql` 与 `124_weapp_reliability.sql`（已有迁移不重复补造数据）。先在隔离数据库验证，再发布服务端 API。
6. 部署 `cloudfunctions/bridge`，云端安装依赖。配置 `FINFOLD_API_BASE=https://www.finfold.app`，以及与服务端相同的 `WEAPP_BRIDGE_SECRET`。密钥只进入服务端环境与云函数环境，不能进入小程序或聊天记录。
7. 保持云函数身份验证及云存储访问控制；确认仅目标小程序用户可以调用。后端原有回调域名不随官网域名改动。
8. 云函数请求超时应覆盖上游 20 秒超时；确保主站每分钟调用 `/api/internal/generation/dispatch`，它会自动结算超过四分钟的待生成任务。
9. 运行微信开发者工具编译、体验版与真机验证。确认当前账号和基础库支持微信 AI 开发模式后验证技能调用。
10. 整理审核材料，经用户确认后上传和送审。上传密钥在本地安全保存，不提交 Git，保持 IP 白名单。

## 实际接口和约束

- `POST /api/weapp/v1/session`：只接受带共享密钥的 bridge，请求身份来自微信云上下文；赠额可幂等重试。
- `GET/PATCH /me`：业务画像与独立的小程序平台偏好；朋友圈偏好不会丢失。
- `GET /opportunities?window=4h|24h|7d`，`GET /opportunities/:id`：按登录用户查询。
- `POST /drafts`：必须含 `requestId`（8–100 位字母、数字、下划线或连字符）。同一次请求重试保持不变，新一版使用新标识；内容改变却复用标识返回 409。
- 创建任务与预扣 3 点额度在同一数据库事务中完成。生成失败/超时的退款和状态更新也在同一事务内完成，重复结算不重复退款。
- `GET /drafts/:id`、`GET /drafts`：只读本人草稿，超时自动结算；后台每分钟扫描，即使用户不回来也可退款。
- `POST /opportunities/:id/share`：用户主动准备分享后创建 22 位随机令牌，仅保存公开标题、事实与证据；不保存画像、个性化理由、角度、分数。
- `GET /shares/:token`：令牌持有者可看公开快照；接收者以自己的身份和额度创作，不借用发送者私有选题 ID。
- 当前微信账户与网站登录账户没有用户绑定流程；不要宣传主站充值会自动补充小程序额度。

## 微信 AI 分包

独立分包 `skills/` 内，`agent/mcp.json` 声明四个 API，`agent/index.js` 注册真实处理函数：看机会、查详情、经用户确认后生成、查询草稿。云环境在分包内独立初始化，不依赖 `getApp()` 或主包代码。

技术依据：[微信官方 AI mode 模板](https://github.com/wechat-miniprogram/ai-mode-skills/blob/master/wxa-skills-generate/references/CODE_TEMPLATES.md)。代码接入不代表账号已获得使用资格；没有真实账号前不能确认平台接入成功。

## 回归验证

主仓执行：

```bash
npm test -- test/weapp-api.test.ts test/weapp-client.test.ts test/weapp-transactions.test.ts test/cn-site-policy.test.ts
npm --prefix apps/weapp run typecheck
```

事务测试使用本地 PostgreSQL 引擎 PGlite，覆盖实际迁移与回滚；它不替代生产迁移核验或多连接并发压测。

真机必须覆盖：首次登录与赠额、填写画像、三时间窗与详情、成稿复制、失败退款、切后台恢复、另一微信用户打开分享、来源核验、AI 四接口和相册拒绝授权。审核、真机、生产发布状态分别记录。
