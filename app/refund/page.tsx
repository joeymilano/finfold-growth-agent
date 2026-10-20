import { isCnDeployment } from "@/lib/site-policy";
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { refundPolicy } from "@/lib/legal";

export const metadata: Metadata = {
  title: isCnDeployment ? `${refundPolicy.title.zh}｜Finfold 内容助手` : `${refundPolicy.title.en} — Finfold`,
  description: refundPolicy.description[isCnDeployment ? "zh" : "en"],
  alternates: { canonical: "/refund" }
};

export default function RefundPage() {
  return <LegalPage doc={refundPolicy} />;
}
