import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
vi.mock("@/lib/site-policy", () => ({ isCnPublicOnly: true }));
import { AuthUserProvider, useAuthUser } from "@/components/auth/AuthUserProvider";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps the public CN site anonymous without requesting closed account APIs", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  function Status() {
    const { ready, user, refresh } = useAuthUser();
    return <button onClick={() => void refresh()}>{ready && !user ? "公开官网" : "加载中"}</button>;
  }
  render(<AuthUserProvider><Status /></AuthUserProvider>);
  screen.getByRole("button", { name: "公开官网" }).click();
  await Promise.resolve();
  expect(fetch).not.toHaveBeenCalled();
});
