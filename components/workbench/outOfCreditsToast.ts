import { addToast } from "@/components/ui/Toast";
import type { Locale } from "@/lib/i18n";
import { BILLING_PATH, outOfCreditsActionLabel, outOfCreditsMessage } from "@/lib/kit-credits";

/** Out-of-Credits toast with a direct path to buy a top-up or upgrade. */
export function showOutOfCreditsToast(locale: Locale): void {
  addToast("error", outOfCreditsMessage(locale), 9000, {
    label: outOfCreditsActionLabel(locale),
    onClick: () => window.location.assign(BILLING_PATH)
  });
}
