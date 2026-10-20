"use client";

import React from "react";

/**
 * Last-resort boundary for errors thrown by the root layout itself. It
 * replaces the whole document, so it renders its own <html>/<body> and cannot
 * rely on providers, theme CSS or the locale hook.
 */
function prefersEnglish(): boolean {
  if (typeof document === "undefined") return false;
  const saved = document.cookie.match(/(?:^|;\s*)finfold-locale=(zh|en)/)?.[1];
  if (saved) return saved === "en";
  return !/^zh/i.test(navigator.language ?? "zh");
}

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const en = prefersEnglish();
  return (
    <html lang={en ? "en" : "zh-CN"}>
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif", background: "#f7f7f5", color: "#1a1a1a" }}>
        <main style={{ maxWidth: 420, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>
            {en ? "Something went wrong" : "页面出了点问题"}
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: "#5f5f5f", margin: "0 0 24px" }}>
            {en ? "Please try again. If it keeps happening, reload the page." : "请重试一次，如果仍然无法打开，请刷新页面。"}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{ padding: "10px 18px", borderRadius: 8, border: "none", background: "#1a1a1a", color: "#fff", fontSize: 14, cursor: "pointer" }}
            >
              {en ? "Try again" : "重试"}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "10px 18px", borderRadius: 8, border: "1px solid #d0d0d0", background: "transparent", color: "inherit", fontSize: 14, cursor: "pointer" }}
            >
              {en ? "Reload page" : "刷新页面"}
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
