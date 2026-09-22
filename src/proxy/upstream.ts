import {
  copyProxyHeaders,
  responseHeaders,
  validateUpstreamUrl
} from "../utils/security";

export async function fetchUpstream(
  request: Request,
  rawUrl: string,
  env: { ALLOWED_HOSTS?: string },
  stateHeaders?: Record<string, string>
): Promise<Response> {
  const target = validateUpstreamUrl(
    rawUrl,
    env.ALLOWED_HOSTS ?? ""
  );

  const headers = copyProxyHeaders(request, stateHeaders);

  return fetch(target.toString(), {
    method: request.method === "HEAD" ? "HEAD" : "GET",
    headers,
    redirect: "follow"
  });
}

export function passThrough(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders(upstream)
  });
}
