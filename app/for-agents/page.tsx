import { isCnDeployment } from "@/lib/site-policy";
import type { Metadata } from "next";
import { ForAgentsGuide } from "@/components/agents/ForAgentsGuide";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: isCnDeployment ? "连接 AI 助手｜Finfold 内容助手" : "Finfold for ChatGPT & AI Agents — Brand-native content with MCP",
  description: isCnDeployment ? "将 Finfold 内容创作能力连接到 AI 助手，创建和保存待审核草稿。" : "Connect Finfold to ChatGPT with OAuth, or use a scoped MCP token with another agent, to create and save brand-native content kits.",
  alternates: { canonical: "/for-agents" },
  openGraph: {
    title: isCnDeployment ? "连接 AI 助手｜Finfold 内容助手" : "Finfold for ChatGPT & AI Agents",
    description: isCnDeployment ? "通过 AI 助手创建和保存待审核草稿。" : "Create and save brand-native, platform-specific content kits from ChatGPT.",
    images: [brand.socialImage]
  },
  twitter: {
    card: "summary_large_image",
    title: isCnDeployment ? "连接 AI 助手｜Finfold 内容助手" : "Finfold for ChatGPT & AI Agents",
    description: isCnDeployment ? "通过 AI 助手创建和保存待审核草稿。" : "Create and save brand-native, platform-specific content kits from ChatGPT.",
    images: [brand.socialImage.url]
  }
};

export default function ForAgentsPage() {
  return <ForAgentsGuide />;
}
