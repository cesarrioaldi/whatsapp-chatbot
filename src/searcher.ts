import axios from 'axios';

/**
 * Web search module for RAG (Retrieval-Augmented Generation).
 * Uses Hermes' ddgs library via local search bridge (same Python DDGS library).
 * Falls back to Wikipedia API if bridge is down.
 */

const BRIDGE_URL = 'http://localhost:32229';
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';

interface SearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Search via the bridge (same ddgs library as Hermes' web_search).
 */
async function searchBridge(query: string, limit: number = 5): Promise<SearchResult[]> {
  try {
    const resp = await axios.get(`${BRIDGE_URL}/`, {
      params: { q: query, limit },
      timeout: 15000,
    });
    const data = resp.data;
    if (data?.results && Array.isArray(data.results)) {
      return data.results.map((r: any) => ({
        title: r.title || '',
        snippet: r.snippet || '',
        url: r.url || '',
      }));
    }
  } catch (e) {
    // Bridge down, continue to Wikipedia fallback
  }
  return [];
}

/**
 * Search Wikipedia as fallback.
 */
async function searchWikipedia(foodName: string, lang: 'id' | 'en'): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  try {
    const clean = foodName.replace(/\b(kalori|calories|per porsi|per serving|berapa|berapa banyak|brand|merek|nama|namanya|tentang)\b/gi, '').trim();
    if (clean.length < 2) return results;
    const resp = await axios.get(`https://${lang}.wikipedia.org/w/api.php`, {
      params: {
        action: 'query',
        list: 'search',
        srsearch: `${clean} ${lang === 'id' ? 'makanan kalori gizi' : 'food calories nutrition'}`,
        format: 'json',
        srlimit: 3,
        srprop: 'snippet',
      },
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });
    const searchResults = resp.data?.query?.search || [];
    for (const r of searchResults) {
      if (!results.some((ex) => ex.title === r.title)) {
        results.push({
          title: r.title,
          snippet: r.snippet.replace(/<[^>]*>/g, ''),
          url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title)}`,
        });
      }
    }
  } catch { /* silent */ }
  return results;
}

/**
 * Format results as text for LLM context injection.
 */
function formatResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `Pencarian untuk "${query}" tidak menemukan hasil. Jawab berdasarkan pengetahuan umum dan beri perkiraan realistis.`;
  }
  let output = `HASIL PENCARIAN UNTUK: "${query}"\n\n`;
  for (const r of results.slice(0, 5)) {
    output += `• ${r.title}\n`;
    output += `  ${r.snippet.substring(0, 300)}\n`;
  }
  output += `\nGunakan informasi di atas. Jika tidak lengkap, beri perkiraan realistis.`;
  return output;
}

/**
 * Search for food/brand information using the same ddgs library as Hermes.
 * Primary: search bridge (ddgs via Python)
 * Fallback: Wikipedia ID → Wikipedia EN
 */
export async function searchFoodCalories(foodName: string): Promise<string> {
  // 1. Bridge (same ddgs as Hermes)
  let results = await searchBridge(foodName);

  // 2. Fallback: Wikipedia ID
  if (results.length < 2) {
    const idResults = await searchWikipedia(foodName, 'id');
    for (const r of idResults) {
      if (!results.some((ex) => ex.title === r.title)) results.push(r);
    }
  }

  // 3. Fallback: Wikipedia EN
  if (results.length < 2) {
    const enResults = await searchWikipedia(foodName, 'en');
    for (const r of enResults) {
      if (!results.some((ex) => ex.title === r.title)) results.push(r);
    }
  }

  return formatResults(foodName, results);
}

/**
 * General web search (alias).
 */
export async function searchWeb(query: string): Promise<string> {
  return searchFoodCalories(query);
}