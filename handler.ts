import { VercelRequest, VercelResponse } from '@vercel/node';
import { authMiddleware } from '../../lib/auth';
import { successResponse, errorResponse } from '../../lib/response';

/**
 * Google Search Scraper
 * Scrape Google SERP results: titles, URLs, snippets, related searches.
 * Uses direct HTTP fetch + HTML parsing (no API key needed).
 */

interface SearchResult { position: number; title: string; url: string; snippet: string; }

function parseSERP(html: string): { results: SearchResult[]; related: string[] } {
  const results: SearchResult[] = [];
  // Extract search result blocks - Google wraps results in divs with class 'g'
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
      // Extract snippet
      const snippetMatch = block.match(/<span[^>]*class="[^"]*"[^>]*>([\s\S]{20,300}?)<\/span>/i);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      results.push({ position: pos++, title, url, snippet });
    }
  }

  // Fallback: simpler extraction if structured parsing fails
  if (results.length === 0) {
    const simpleRe = /<a[^>]+href="(https?:\/\/(?!www\.google)[^"]+)"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>/gi;
    while ((match = simpleRe.exec(html)) !== null && pos <= 20) {
      results.push({ position: pos++, title: match[2].replace(/<[^>]+>/g, '').trim(), url: match[1], snippet: '' });
    }
  }

  // Related searches
  const related: string[] = [];
  const relRe = /<a[^>]*class="[^"]*related[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  while ((match = relRe.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, '').trim();
    if (text && text.length > 2) related.push(text);
  }

  return { results, related };
}

async function handler(req: VercelRequest, res: VercelResponse) {
  const { query, num_results, language, country } = req.body || {};
  if (!query || typeof query !== 'string') return errorResponse(res, 'query is required', 400);
  if (query.length > 500) return errorResponse(res, 'Query too long (max 500 chars)', 400);

  try {
    const startTime = Date.now();
    const limit = Math.min(num_results || 10, 20);
    const params = new URLSearchParams({ q: query, num: String(limit), hl: language || 'en', gl: country || 'us' });
    const url = `https://www.google.com/search?${params}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': `${language || 'en'}-US,en;q=0.9`,
      },
      redirect: 'follow', signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return errorResponse(res, `Google returned ${response.status}`, 502);
    const html = await response.text();
    const parsed = parseSERP(html);

    return successResponse(res, {
      query, results: parsed.results.slice(0, limit), related_searches: parsed.related,
      total_results: parsed.results.length,
      _meta: { skill: 'google-search-scraper', latency_ms: Date.now() - startTime, language: language || 'en', country: country || 'us' },
    });
  } catch (error: any) {
    return errorResponse(res, 'Search scraping failed', 500, error.message);
  }
}

export default authMiddleware(handler);
