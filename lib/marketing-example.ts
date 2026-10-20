/** Editorial examples based on the implemented workbench auth-draft flow.
 * Evidence: lib/workbench-auth-draft.ts and DashboardWorkbench.tsx.
 * These are manually prepared illustrations, not a customer or model run.
 */
export const marketingExampleSource = {
  zh: "Finfold 的工具页现在可以把原材料保存在当前浏览器 7 天。用户登录后回到同一份草稿，核对平台再确认生成。登录链接只携带草稿编号，不携带原文。但换设备或清理浏览器存储后，草稿不会同步。欢迎用一段自己的产品更新试试。",
  en: "Finfold keeps source material from its tool pages in the current browser for 7 days. When users sign in, they return to the same draft, check the platform, and explicitly start generation. The sign-in link contains a draft ID, not the source text. But drafts do not sync across devices or survive cleared browser storage. Try it with a real product update."
};

export const marketingExampleOutputs = {
  wechat: {
    title: "登录前写下的材料，登录后接着用",
    body: "在 Finfold 工具页贴入材料并点击继续，草稿会在当前浏览器保留 7 天。登录后可以核对原文和目标平台，再确认生成。\n\n文章提纲\n1. 在工具页准备原材料\n2. 登录后检查同一份草稿\n3. 确认生成，审核后复制使用\n\n请留意，换设备或清理浏览器存储后，需要重新贴入材料。",
    noteEn: "WeChat outline and opening excerpt in Chinese. Expand only when your source supports more detail.",
    noteZh: "公众号提纲与开头节选。原材料足够时，再展开成长文。"
  },
  linkedin: {
    title: "A sign-in step should not mean rewriting your brief.",
    body: "Finfold now keeps tool-page source drafts in the same browser for 7 days. Sign in, check your draft and platform, then choose when to generate.\n\nThe return link carries a draft ID, not your text. This is browser-local storage, so switching devices or clearing storage means starting again.\n\nTry it with your next product update.",
    noteEn: "LinkedIn post. Short caption option: Keep your source through sign-in, then review before generating. Release-note option: Added browser-local tool drafts with a 7-day expiry.",
    noteZh: "LinkedIn 帖子。短配文可写“登录后接着使用原材料，确认后再生成”。发布说明可写“新增工具页本地草稿，保存期限为 7 天”。"
  },
  xiaohongshu: {
    title: "写到一半要登录，材料还能留住吗",
    body: "在 Finfold 工具页贴好产品更新，点击继续后，材料会存在当前浏览器里，保留 7 天。\n\n登录后先看一遍草稿和平台，再点生成。登录链接里只有草稿编号，不带原文。\n\n换设备或清理浏览器存储，材料就不会跟过来，重要内容记得另外备份。\n\n#产品更新 #内容创作",
    noteEn: "English source adapted into a Chinese RED note. Keep product facts; do not invent a local customer, testimonial, or results.",
    noteZh: "按手机阅读习惯整理的笔记示范。保留产品事实，不补造用户经历或效果。"
  },
  x: {
    title: "Keep your brief through sign-in.",
    body: "Finfold saves tool-page drafts in your browser for 7 days. Sign in, review, then generate. The return link carries an ID, not your text. Switching devices or clearing storage? Keep a separate copy.",
    noteEn: "A short update for X. Check the final length and facts before posting.",
    noteZh: "X 短更新示范。发布前核对实际字数和事实。"
  }
} as const;
