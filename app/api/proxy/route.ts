import { NextRequest, NextResponse } from "next/server";

// Handle CORS pre-flight requests from browsers and IPTV players
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = searchParams.get("url");

  if (!targetUrl) {
    return new Response("Missing 'url' parameter", { status: 400 });
  }

  try {
    // Forward Range header if the player asks for specific byte ranges (vital for scrubbing/seeking)
    const rangeHeader = request.headers.get("range");
    const fetchHeaders: HeadersInit = {
      "User-Agent": request.headers.get("user-agent") || "VLC/3.0.16 LibVLC/3.0.16",
      ...(request.headers.get("referer") ? { Referer: request.headers.get("referer")! } : {}),
      ...(rangeHeader ? { Range: rangeHeader } : {}),
    };

    const upstreamResponse = await fetch(targetUrl, {
      headers: fetchHeaders,
      cache: "no-store",
      redirect: "follow",
    });

    if (!upstreamResponse.ok && upstreamResponse.status !== 206) {
      return new Response(`Upstream fetch failed: ${upstreamResponse.statusText}`, {
        status: upstreamResponse.status,
      });
    }

    const finalUpstreamUrl = upstreamResponse.url || targetUrl;
    const contentType = upstreamResponse.headers.get("content-type") || "";
    const isM3u8 =
      targetUrl.includes(".m3u8") ||
      finalUpstreamUrl.includes(".m3u8") ||
      contentType.includes("application/vnd.apple.mpegurl") ||
      contentType.includes("audio/mpegurl") ||
      contentType.includes("text/plain");

    const host = request.headers.get("host") || "localhost:3000";
    const protocol = request.headers.get("x-forwarded-proto") || "http";
    // Change this to match your proxy path (e.g., /api/proxy or /proxy.php)
    const domainProxyPrefix = `${protocol}://${host}/api/proxy`;

    if (isM3u8) {
      const text = await upstreamResponse.text();
      const lines = text.split("\n");
      const resolvedBaseUrl = new URL(finalUpstreamUrl);

      const rewrittenLines = lines.map((line) => {
        const trimmed = line.trim();

        if (!trimmed || trimmed.startsWith("#")) {
          if (trimmed.includes('URI="')) {
            return trimmed.replace(/URI="([^"]+)"/, (match, uri) => {
              const absoluteUri = new URL(uri, resolvedBaseUrl).toString();
              return `URI="${domainProxyPrefix}?url=${encodeURIComponent(absoluteUri)}"`;
            });
          }
          return line;
        }

        let absoluteSegmentUrl: string;
        try {
          absoluteSegmentUrl = new URL(trimmed, resolvedBaseUrl).toString();
        } catch {
          return line;
        }

        const urlObj = new URL(absoluteSegmentUrl);
        const pathSegments = urlObj.pathname.split("/");
        const fileName = pathSegments[pathSegments.length - 1] || "segment.ts";

        return `${domainProxyPrefix}?url=${encodeURIComponent(absoluteSegmentUrl)}&file=${encodeURIComponent(fileName)}`;
      });

      return new Response(rewrittenLines.join("\n"), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      });
    } else {
      // Stream media fragments (.ts / .mp4) back to the browser with range support
      const responseHeaders = new Headers();
      if (contentType) responseHeaders.set("Content-Type", contentType);
      
      const contentLength = upstreamResponse.headers.get("content-length");
      if (contentLength) responseHeaders.set("Content-Length", contentLength);
      
      const contentRange = upstreamResponse.headers.get("content-range");
      if (contentRange) responseHeaders.set("Content-Range", contentRange);

      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      responseHeaders.set("Accept-Ranges", "bytes");

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: responseHeaders,
      });
    }
  } catch (error: any) {
    return new Response(`Proxy Error: ${error.message || "Internal Error"}`, {
      status: 500,
    });
  }
}