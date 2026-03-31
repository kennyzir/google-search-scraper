// ClawHub Local Skill - runs entirely in your agent, no API key required
// Google Search Scraper - Scrape Google SERP results

interface SearchResult { position: number; title: string; url: string; snippet: string; }

function parseSERP(html: string): { results: SearchResult[]; related: string[] } {
  const results: SearchResult[] = [];
  const blockRe = /<div class="[^"]*\bg\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  let match;
  let pos = 1;
  while ((match = blockRe.exec(html)) !== null && pos <= 20) {
    const block = match[1];
    const linkMatch = block.match(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>/i);
    const titleMatch = block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
    if (linkMatch && titleMatch) {
      const url = linkMatch[1];
      if (url.includes('google.com/search')) continue;
      const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
      const snippetMatch = block.match(/<span[^>]*class="[^"]*"[^>]*>([\s\S]{20,300}?)<\/span>/i);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      results.push({ position: pos++, title, url, snippet });
    }
  }
  if (results.length === 0) {
    const simpleRe = /<a[^>]+href="(https?:\/\/(?!www\.google)[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    while ((match = simpleRe.exec(html)) !== null && pos <= 20) {
      results.push({ position: pos++, title: match[2].replace(/<[^>]+>/g, '').trim(), url: match[1], snippet: '' });
    }
  }
  const related: string[] = [];
  const relRe = /<a[^>]*class="[^"]*related[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = relRe.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text && text.length > 2) related.push(text);
  }
  return { results, related };
}

export async function run(input: { query: string; num_results?: number; language?: string; country?: string }) {
  if (!input.query || typeof input.query !== 'string') throw new Error('query is required');
  if (input.query.length > 500) throw new Error('Query too long (max 500 chars)');

  const startTime = Date.now();
  const limit = Math.min(input.num_results || 10, 20);
  const params = new URLSearchParams({ q: input.query, num: String(limit), hl: input.language || 'en', gl: input.country || 'us' });
  const url = `https://www.google.com/search?${params}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': `${input.language || 'en'}-US,en;q=0.9`,
    },
    redirect: 'follow', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Google returned ${response.status}`);
  const html = await response.text();
  const parsed = parseSERP(html);

  return {
    query: input.query, results: parsed.results.slice(0, limit), related_searches: parsed.related,
    total_results: parsed.results.length,
    _meta: { skill: 'google-search-scraper', latency_ms: Date.now() - startTime, language: input.language || 'en', country: input.country || 'us' },
  };
}

export default run;
