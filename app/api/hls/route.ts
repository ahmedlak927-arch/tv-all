import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url');

  if (!urlParam) {
    return NextResponse.json({ error: 'Missing stream URL' }, { status: 400 });
  }

  try {
    const targetUrl = new URL(urlParam);

    // Replicate full target domain authority for CloudFront / Token validation
    const originBase = `${targetUrl.protocol}//${targetUrl.host}`;

    const response = await fetch(targetUrl.toString(), {
      headers: {
        'User-Agent': 'VLC/3.0.18 LibVLC/3.0.18', // Use VLC client signature which CDNs universally whitelist
        'Accept': '*/*',
        'Referer': originBase + '/',
        'Origin': originBase,
        'Connection': 'keep-alive',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Stream responded with status ${response.status}` }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || '';

    // If it's an m3u8 playlist, process text and rewrite relative/absolute links through proxy
    if (contentType.includes('application') || contentType.includes('text') || targetUrl.pathname.endsWith('.m3u8')) {
      const bodyText = await response.text();
      const pathDir = targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1);

      const rewrittenLines = bodyText.split('\n').map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          return line;
        }

        let absoluteSegmentUrl = '';
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
          absoluteSegmentUrl = trimmed;
        } else if (trimmed.startsWith('/')) {
          absoluteSegmentUrl = `${originBase}${trimmed}`;
        } else {
          absoluteSegmentUrl = `${originBase}${pathDir}${trimmed}`;
        }

        return `/api/hls?url=${encodeURIComponent(absoluteSegmentUrl)}`;
      });

      return new NextResponse(rewrittenLines.join('\n'), {
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // For binary data (.ts fragments), pipe the ArrayBuffer directly to avoid corruption
    const arrayBuffer = await response.arrayBuffer();

    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType || 'video/mp2t',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    console.error('Proxy routing error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}