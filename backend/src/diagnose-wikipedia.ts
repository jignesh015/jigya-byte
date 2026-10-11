// Read-only public endpoint diagnostics. Never includes provider keys or response text.
const paths = ['/w/rest.php/v1/search/page?q=Space&limit=8', '/w/rest.php/v1/page/Space', '/api/rest_v1/page/summary/Space'];
for (const style of ['phone-header', 'backend-header']) {
  for (const path of paths) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    headers[style === 'phone-header' ? 'Api-User-Agent' : 'User-Agent'] = style === 'phone-header' ? 'JigyaByte/1.0 (Expo Go personal learning app)' : 'JigyaByte/0.1 (personal local learning backend)';
    try {
      const response = await fetch(`https://en.wikipedia.org${path}`, { headers, signal: AbortSignal.timeout(9000) });
      console.log(JSON.stringify({ style, endpoint: path.split('?')[0], status: response.status,
        contentType: response.headers.get('content-type'), retryAfter: response.headers.get('retry-after') }));
      await response.body?.cancel();
    } catch { console.log(JSON.stringify({ style, endpoint: path.split('?')[0], result: 'network_or_timeout' })); }
    await new Promise(r => setTimeout(r, 1200));
  }
}
