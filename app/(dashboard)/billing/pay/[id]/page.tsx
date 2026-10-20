import React from "react";
import { PayOrderClient } from "@/components/billing/ZcwOrderStatusClient";

// Server entry — resolves the [id] param (Next 15 params are async) and hands
// the orderId to the client component. Scan-to-pay orders show their live
// status (this is also the wallet's return URL); legacy transfer-QR orders
// fall back to their historical view.
export default async function PayPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PayOrderClient orderId={id} />;
}
