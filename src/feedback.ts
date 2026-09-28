import { Auth } from './auth.js';
import { CliError, usage } from './errors.js';
import { request } from './http.js';

export const feedbackFilters = ['all', 'open', 'under_review', 'planned', 'in_progress', 'complete', 'mine', 'upvoted_by_me'];
export const roadmapFilters = ['all', 'mine', 'upvoted_by_me'];
export const feedbackSorts = ['trending', 'top', 'new'];
const fields = new Set(['uuid', 'name', 'description', 'slug', 'post_count', 'title', 'status', 'vote_count', 'comment_count',
  'created_words', 'updated_words', 'is_mine', 'upvoted_by_me', 'board_name', 'board_slug', 'merged_into_slug', 'merged_into_post',
  'author', 'upvoted_by', 'comments', 'similar_posts', 'content', 'is_pinned', 'replies', 'countryCode', 'validSubscription',
  'subscriptionTier', 'instructor', 'profileImageUrl', 'boards', 'posts', 'current_page', 'per_page', 'total_pages', 'total_entries',
  'planned', 'in_progress', 'complete', 'board', 'entries', 'type', 'voters', 'others_count', 'post_link', 'message', 'post', 'comment']);

function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)).map(([key, entry]) => [key, clean(entry)]));
  return value;
}
function result(value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliError('INVALID_RESPONSE', 'Unexpected feedback response.');
  return clean(value);
}
function key(value: string) {
  if (!/^[\p{L}\p{N}_-]+$/u.test(value)) usage('Use a feedback board/post slug or comment UUID, without a URL or path.');
  return encodeURIComponent(value);
}
function text(value: string, label: string, maximum: number) {
  if (!value.trim() || value.length > maximum) usage(`${label} must contain 1–${maximum} characters.`);
  return value.trim();
}
function choice(value: string, choices: string[]) {
  if (!choices.includes(value)) usage(`Choose from: ${choices.join(', ')}.`);
  return value;
}
export type PostOptions = { search?: string; filter?: string; sort?: string; page?: string };

export class FeedbackClient {
  constructor(private auth: Auth) {}

  private async get(path: string, params: Record<string, string> = {}, retryReads = true) {
    const query = new URLSearchParams(params).toString();
    const endpoint = `/api/v3/feedback/${path}${query ? `?${query}` : ''}`;
    const personalized = ['mine', 'upvoted_by_me'].includes(params.filter || '');
    // An existing session supplies vote/ownership state. Never silently discard a
    // rejected session or send credentials belonging to another API environment.
    const signedIn = this.auth.environment.clientId && await this.auth.credentials.read();
    return result(signedIn || personalized ? await this.auth.get(endpoint, 'feedback_read', retryReads)
      : await request(`${this.auth.environment.apiUrl}${endpoint}`, {}, 15_000, retryReads));
  }

  private async write(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown = {}) {
    return result(await this.auth.write(method, `/api/v3/feedback/${path}`, body, 'feedback_write'));
  }

  private filters(options: PostOptions, roadmap = false) {
    const params: Record<string, string> = {};
    if (options.search !== undefined) params.search = text(options.search, 'Search', 2000);
    if (options.filter) params.filter = choice(options.filter, roadmap ? roadmapFilters : feedbackFilters);
    return params;
  }

  private page(value = '1') {
    if (!/^[1-9]\d{0,5}$/.test(value)) usage('--page must be a positive integer, at most 999999.');
    return value;
  }

  boards() { return this.get('boards'); }
  suggested(board: string, title: string, description?: string) {
    key(board);
    return this.get('posts/suggested', { board_slug: board, title: text(title, 'Title', 255),
      ...(description === undefined ? {} : { description: text(description, 'Description', 10_000) }) }, false);
  }
  async roadmap(options: PostOptions) { return { roadmap: await this.get('roadmap', this.filters(options, true)) }; }
  posts(board: string, options: PostOptions) {
    key(board);
    return this.get('posts', { ...this.filters(options), board_slug: board,
      sort: choice(options.sort || 'trending', feedbackSorts), page: this.page(options.page) });
  }
  async show(board: string, post: string) { return { post: await this.get(`posts/${key(board)}/${key(post)}`) }; }
  async feed(board: string, options: { page?: string; types?: string }) {
    const types = (options.types || 'posts,comments,votes').split(',');
    types.forEach(type => choice(type, ['posts', 'comments', 'votes']));
    return { feed: await this.get(`boards/${key(board)}/feed`, { page: this.page(options.page),
      ...Object.fromEntries(['posts', 'comments', 'votes'].map(type => [type, String(types.includes(type))])) }) };
  }
  vote(board: string, post: string, remove: boolean) { return this.write('POST', `posts/${key(board)}/${key(post)}/${remove ? 'downvote' : 'upvote'}`); }
  create(board: string, title: string, description: string) {
    key(board);
    return this.write('POST', 'posts', { board_slug: board, title: text(title, 'Title', 255), description: text(description, 'Description', 10_000) });
  }
  update(board: string, post: string, title: string, description: string) {
    return this.write('PATCH', `posts/${key(board)}/${key(post)}`, { title: text(title, 'Title', 255), description: text(description, 'Description', 10_000) });
  }
  comment(postUuid: string, content: string, parent?: string) {
    key(postUuid);
    if (parent) key(parent);
    return this.write('POST', 'comments', { post_uuid: postUuid, content: text(content, 'Comment', 10_000), ...(parent ? { parent_comment_uuid: parent } : {}) });
  }
  editComment(uuid: string, content: string) { return this.write('PATCH', `comments/${key(uuid)}`, { content: text(content, 'Comment', 10_000) }); }
  deleteComment(uuid: string) { return this.write('DELETE', `comments/${key(uuid)}`); }
  voteComment(uuid: string, remove: boolean) { return this.write('POST', `comments/${key(uuid)}/${remove ? 'downvote' : 'upvote'}`); }
}
