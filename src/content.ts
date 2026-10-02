import { CliError, usage } from './errors.js';
import { request } from './http.js';

export interface ContentOptions { locale?: string; limit?: number }
export interface HistoryOptions extends ContentOptions {
  version?: string; fromVersion?: string; toVersion?: string; fromDate?: string; toDate?: string; latest?: boolean; all?: boolean;
}

export class ContentClient {
  constructor(private readonly apiUrl: string) {}

  async terms(query?: string, options: { page?: number; limit?: number } = {}) {
    if (query !== undefined && (!query.trim() || query.length > 200)) usage('Search must contain 1–200 characters.');
    const page = options.page ?? 1, limit = options.limit ?? 20;
    if (!Number.isInteger(page) || page < 1 || page > 10000) usage('--page must be an integer from 1 to 10000.');
    const result = await this.get('/sailing-terms', { limit }, query?.trim(), { page: String(page) });
    if (!Array.isArray(result.terms) || !result.terms.every((entry: any) => typeof entry.term === 'string' && typeof entry.definition === 'string') || typeof result.source !== 'string') throw new CliError('INVALID_RESPONSE', 'Expected sailing glossary terms.');
    return { glossary: result };
  }

  async term(term: string) {
    if (!term.trim() || term.length > 200) usage('Term must contain 1–200 characters.');
    const result = await this.get('/sailing-terms/lookup', {}, undefined, { term: term.trim() });
    if (typeof result.term !== 'string' || typeof result.definition !== 'string' || typeof result.source !== 'string') throw new CliError('INVALID_RESPONSE', 'Expected a sailing glossary definition.');
    return { term: result };
  }

  private async get(path: string, options: ContentOptions = {}, query?: string, filters: Record<string, string | boolean> = {}) {
    if (options.locale !== undefined && !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(options.locale)) usage('Use a language code such as en-US for --locale.');
    if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20)) usage('--limit must be an integer from 1 to 20.');
    const url = new URL(`/api/v2/content${path}`, this.apiUrl);
    if (options.locale) url.searchParams.set('locale', options.locale);
    if (options.limit !== undefined) url.searchParams.set('limit', String(options.limit));
    if (query !== undefined) url.searchParams.set('q', query);
    for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, String(value));
    const result = await request(url.href);
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new CliError('INVALID_RESPONSE', 'Unexpected public content response.');
    return result;
  }

  async topics(options: ContentOptions = {}) {
    const result = await this.get('/faqs', options);
    if (!Array.isArray(result.topics)) throw new CliError('INVALID_RESPONSE', 'Expected FAQ topics.');
    return { topics: result.topics };
  }

  async faq(slug: string, options: ContentOptions = {}) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) usage('Use a topic slug from marineverse faq, without a URL or path.');
    const faq = await this.get(`/faqs/${encodeURIComponent(slug)}`, options);
    if (typeof faq.title !== 'string' || !Array.isArray(faq.content?.sections)) throw new CliError('INVALID_RESPONSE', 'Expected FAQ content.');
    return { faq };
  }

  async history(options: HistoryOptions = {}) {
    const ranges = [options.fromVersion, options.toVersion, options.fromDate, options.toDate];
    const modes = [options.version !== undefined, !!options.latest, !!options.all].filter(Boolean).length;
    if (modes > 1 || (modes && ranges.some(value => value !== undefined))) usage('Choose latest, one version, a range, or --all.');
    if (options.all && options.limit !== undefined) usage('--all cannot be combined with --limit.');
    for (const value of [options.version, options.fromVersion, options.toVersion]) {
      if (value !== undefined && !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) usage('Use a release version such as 2.9.7.');
    }
    for (const value of [options.fromDate, options.toDate]) {
      if (value !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) usage('Use a real ISO date such as 2025-01-31.');
    }
    if (options.fromVersion && options.toVersion) {
      const from = options.fromVersion.split('.').map(Number), to = options.toVersion.split('.').map(Number);
      const index = from.findIndex((value, position) => value !== to[position]);
      if (index >= 0 && from[index]! > to[index]!) usage('The version range starts after it ends.');
    }
    if (options.fromDate && options.toDate && options.fromDate > options.toDate) usage('The date range starts after it ends.');
    const filters: Record<string, string | boolean> = {};
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined && !['locale', 'limit'].includes(key)) filters[key.replace(/[A-Z]/g, char => `_${char.toLowerCase()}`)] = value;
    }
    const history = await this.get('/history/marineverse-sailing-club', options, undefined, filters);
    if (typeof history.title !== 'string' || !Array.isArray(history.content?.entries)) throw new CliError('INVALID_RESPONSE', 'Expected Sailing Club history.');
    return { history };
  }

  async changelog(options: HistoryOptions = {}) {
    const result = await this.history(options);
    return { history: { ...result.history, content: { ...result.history.content, sections: [] } } };
  }

  async search(query: string, options: ContentOptions = {}) {
    if (!query.trim() || query.length > 200) usage('Search must contain 1–200 characters.');
    const search = await this.get('/search', options, query.trim());
    if (!Array.isArray(search.results)) throw new CliError('INVALID_RESPONSE', 'Expected public content search results.');
    return { search };
  }
}
