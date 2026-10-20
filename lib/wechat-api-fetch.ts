import { readBytesWithLimit } from "@/lib/safe-url";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Route only WeChat API traffic through the operator's authenticated fixed-IP relay. */
export async function wechatApiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: FetchLike = fetch,
  environment: Record<string, string | undefined> = process.env
): Promise<Response> {
  const relay = environment.WECHAT_API_EGRESS_URL?.trim();
  if (!relay) return fetcher(input, init);
  const token = environment.WECHAT_API_EGRESS_TOKEN?.trim();
  if (!token) throw new Error("WeChat fixed-IP egress credentials are missing.");
  const target = new URL(input instanceof Request ? input.url : String(input));
  const origin = new URL(relay);
  if (target.origin !== "https://api.weixin.qq.com" || target.username || target.password
    || origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("Invalid WeChat fixed-IP egress target.");
  }
  const request = new Request(input, init);
  if (request.method !== "POST") throw new Error("Unsupported WeChat API egress method.");
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");
  headers.set("x-finfold-wechat-egress-token", token);
  const body = request.body ? await readBytesWithLimit(new Response(request.body), 12 * 1024 * 1024) : undefined;
  origin.pathname = origin.pathname.replace(/\/$/, "") + target.pathname;
  origin.search = target.search;
  const response = await fetcher(origin, {
    method: "POST", headers, body: body as BodyInit | undefined,
    cache: "no-store", redirect: "manual", signal: request.signal
  });
  // Workers supports manual redirects; reject them before sending credentials elsewhere.
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new Error("WeChat fixed-IP egress redirect rejected.");
  }
  return response;
}
