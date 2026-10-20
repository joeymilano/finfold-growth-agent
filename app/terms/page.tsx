import { isCnDeployment } from "@/lib/site-policy";
import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";
import { termsOfService } from "@/lib/legal";

export const metadata: Metadata = {
  title: isCnDeployment ? `${termsOfService.title.zh}｜Finfold 内容助手` : `${termsOfService.title.en} — Finfold`,
  description: termsOfService.description[isCnDeployment ? "zh" : "en"],
  alternates: { canonical: "/terms" }
};

export default function TermsPage() {
  return <LegalPage doc={termsOfService} />;
}
