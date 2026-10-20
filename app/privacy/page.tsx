import { isCnDeployment } from "@/lib/site-policy";
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { privacyPolicy } from "@/lib/legal";

export const metadata: Metadata = {
  title: isCnDeployment ? `${privacyPolicy.title.zh}｜Finfold 内容助手` : `${privacyPolicy.title.en} | Personal Data, AI & Analytics — Finfold`,
  description: privacyPolicy.description[isCnDeployment ? "zh" : "en"],
  alternates: { canonical: "/privacy" }
};

export default function PrivacyPage() {
  return <LegalPage doc={privacyPolicy} />;
}
