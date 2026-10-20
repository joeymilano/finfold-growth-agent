import { beforeEach, describe, expect, it, vi } from "vitest";
import { canRetryDraftPublication, draftPublicationPhase } from "@/lib/content-pipeline/publication-state";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  createJob: vi.fn(),
  findConnection: vi.fn()
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: () => true }));
vi.mock("@/lib/content-pipeline/settings", () => ({
  guardContentPipelineRequest: mocks.guard,
  contentPipelineErrorResponse: (error: unknown) => new Response(JSON.stringify({ error: String(error) }), { status: 400 })
}));
vi.mock("@/lib/content-pipeline/generate", () => ({
  findWechatConnectionTarget: mocks.findConnection,
  regenerateDailyArticle: vi.fn()
}));
vi.mock("@/lib/content-pipeline/cards", () => ({ regenerateDailyCardSet: vi.fn() }));
vi.mock("@/lib/wechat-publication-create", () => ({ createWechatPublicationJobFromOutput: mocks.createJob }));

import { POST } from "@/app/api/content-pipeline/articles/[runId]/decision/route";

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "update", "insert"]) builder[method] = () => builder;
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ error: null });
  return builder;
}

function adminWith(jobStatus: string) {
  return {
    from: (table: string) => {
      if (table === "content_pipeline_runs") {
        return chain({
          data: {
            id: "run-1",
            channel: "wechat_articles",
            status: "draft_sent",
            output_id: "output-1",
            kit_id: "kit-1",
            auto_review: null,
            extra: {},
            publication_job_id: "job-1"
          }
        });
      }
      if (table === "wechat_publication_jobs") return chain({ data: { status: jobStatus }, error: null });
      if (table === "kit_outputs") return chain({ data: { updated_at: "2026-10-18T00:00:00.000Z" } });
      if (table === "content_pipeline_settings") return chain({ data: { wechat_theme: "default" }, error: null });
      throw new Error(`unexpected table ${table}`);
    }
  };
}

function request() {
  return new Request("http://localhost/api/content-pipeline/articles/run-1/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision: "publish_to_draft" })
  });
}

describe("daily pipeline draft publication state", () => {
  it("only reports the draft box once the job actually delivered", () => {
    expect(draftPublicationPhase("scheduled")).toBe("pending");
    expect(draftPublicationPhase("preparing")).toBe("pending");
    expect(draftPublicationPhase("draft_ready")).toBe("done");
    expect(draftPublicationPhase("failed")).toBe("failed");
    expect(canRetryDraftPublication("failed")).toBe(true);
    expect(canRetryDraftPublication("preparing")).toBe(false);
    expect(canRetryDraftPublication("draft_ready")).toBe(false);
  });

  beforeEach(() => {
    mocks.createJob.mockReset();
    mocks.findConnection.mockResolvedValue({ accountId: "account-1", displayName: "Finfold" });
  });

  it("lets a failed draft job be retried instead of answering 409", async () => {
    mocks.guard.mockResolvedValue({ ok: true, context: { userId: "user-1", admin: adminWith("failed") } });
    mocks.createJob.mockResolvedValue({ ok: true, job: { id: "job-2" } });
    const response = await POST(request(), { params: Promise.resolve({ runId: "run-1" }) });
    expect(response.status).toBe(200);
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
  });

  it("still blocks a second send while the first job is running or done", async () => {
    mocks.guard.mockResolvedValue({ ok: true, context: { userId: "user-1", admin: adminWith("preparing") } });
    const response = await POST(request(), { params: Promise.resolve({ runId: "run-1" }) });
    expect(response.status).toBe(409);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
