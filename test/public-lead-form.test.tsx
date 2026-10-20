import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicLeadForm } from "@/components/leads/PublicLeadForm";

vi.mock("next/script", () => ({ default: () => null }));
afterEach(() => { delete window.turnstile; });

describe("public lead form", () => {
  it("keeps verification in the selected appearance without submitting the form", async () => {
    const renderWidget = vi.fn().mockReturnValue("test-widget");
    const removeWidget = vi.fn();
    window.turnstile = { render: renderWidget, remove: removeWidget, reset: vi.fn() };
    document.documentElement.setAttribute("data-theme", "dark");
    const { unmount } = render(<PublicLeadForm code="abc123def456" displayName="Finfold" destinationHost="finfold.app" acceptingSubmissions locale="en" siteKey="test-key" />);
    await waitFor(() => expect(renderWidget).toHaveBeenLastCalledWith(expect.any(HTMLElement), expect.objectContaining({ theme: "dark" })));
    document.documentElement.setAttribute("data-theme", "light");
    await waitFor(() => expect(renderWidget).toHaveBeenLastCalledWith(expect.any(HTMLElement), expect.objectContaining({ theme: "light" })));
    expect(removeWidget).toHaveBeenCalledWith("test-widget");
    expect(screen.getByRole("button", { name: /Complete verification/ })).toBeDisabled();
    unmount();
  });
  it("asks for explicit business context and privacy consent", () => {
    render(
      <PublicLeadForm
        code="abc123def456"
        displayName="Finfold"
        destinationHost="finfold.app"
        acceptingSubmissions
        locale="en"
        siteKey=""
      />
    );

    expect(screen.getByRole("heading", { name: "Start with the problem worth solving." })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Company or brand" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "Work email" })).toBeRequired();
    expect(screen.getByRole("textbox", { name: "What are you trying to achieve?" })).toBeRequired();
    expect(screen.getByRole("checkbox")).toBeRequired();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("button", { name: /Complete verification/ })).toBeDisabled();
    expect(screen.getByText("No scraped contact details")).toBeInTheDocument();
  });

  it("does not render an active form after the mission closes", () => {
    render(
      <PublicLeadForm
        code="abc123def456"
        displayName="Finfold"
        destinationHost="finfold.app"
        acceptingSubmissions={false}
        locale="en"
        siteKey="site-key"
      />
    );
    expect(screen.getByRole("heading", { name: "This conversation is paused." })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
