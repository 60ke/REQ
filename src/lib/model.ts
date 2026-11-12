import type { Environment, HttpRequest, KeyValue, Workspace } from './types';
export const uid = () => crypto.randomUUID();
export const row = (key = '', value = '', description = ''): KeyValue => ({
  id: uid(),
  key,
  value,
  description,
  enabled: true,
});
export const makeRequest = (): HttpRequest => ({
  id: uid(),
  name: 'Untitled request',
  method: 'GET',
  url: '',
  headers: [],
  query: [],
  bodyType: 'none',
  body: '',
  auth: { type: 'none' },
  timeoutMs: 30000,
  followRedirects: false,
});
export const secretPattern =
  /(?:authorization|cookie|api[-_]?key|token|password|passwd|secret|credential)/i;
export function interpolate(value: string, environment: Record<string, string>): string {
  let output = '';
  let rest = value;
  while (rest.includes('{{')) {
    const start = rest.indexOf('{{');
    const end = rest.indexOf('}}', start + 2);
    if (end < 0) throw new Error('Unclosed environment variable. Use {{variable}}.');
    const key = rest.slice(start + 2, end).trim();
    if (!key) throw new Error('An environment variable name is empty.');
    if (!Object.hasOwn(environment, key))
      throw new Error(`Environment variable “${key}” is not defined.`);
    output += rest.slice(0, start) + environment[key];
    rest = rest.slice(end + 2);
  }
  return output + rest;
}
export function environmentValues(environment?: Environment): Record<string, string> {
  return Object.fromEntries(
    (environment?.variables ?? [])
      .filter((x) => x.enabled && x.key.trim())
      .map((x) => [x.key.trim(), x.value]),
  );
}
export function buildUrl(request: HttpRequest, environment: Record<string, string>): string {
  const url = new URL(interpolate(request.url, environment));
  if (!['http:', 'https:'].includes(url.protocol))
    throw new Error('Use an http:// or https:// URL.');
  if (url.username || url.password)
    throw new Error('Put URL credentials in the Authorization tab instead of the URL.');
  for (const item of request.query)
    if (item.enabled && item.key.trim())
      url.searchParams.append(
        interpolate(item.key, environment),
        interpolate(item.value, environment),
      );
  if (request.auth.type === 'apiKey' && request.auth.location === 'query') {
    const key = interpolate(request.auth.key ?? '', environment);
    if (!key.trim()) throw new Error('The API key parameter name is empty.');
    url.searchParams.append(key, interpolate(request.auth.value ?? '', environment));
  }
  return url.toString();
}
export function splitUrlQuery(url: string): { url: string; query: KeyValue[] } {
  const i = url.indexOf('?');
  const firstFragment = url.indexOf('#');
  if (i === -1 || (firstFragment >= 0 && firstFragment < i)) return { url, query: [] };
  const fragmentAt = url.indexOf('#', i);
  const params = new URLSearchParams(url.slice(i + 1, fragmentAt < 0 ? undefined : fragmentAt));
  return {
    url: url.slice(0, i) + (fragmentAt < 0 ? '' : url.slice(fragmentAt)),
    query: [...params].map(([key, value]) => row(key, value)),
  };
}
const preservePlaceholder = (value?: string) =>
  value && /^(?:Bearer )?\{\{[^{}]+\}\}$/.test(value.trim()) ? value : '';
// Keep untouched URL/form bytes and template markers intact. Re-encoding them
// would turn {{token}} into %7B%7Btoken%7D%7D and prevent later substitution.
function sanitizeEncodedFields(value: string): string {
  return value
    .split('&')
    .map((piece) => {
      const entry = new URLSearchParams(piece).entries().next().value;
      if (!entry || !secretPattern.test(entry[0]) || !entry[1] || preservePlaceholder(entry[1]))
        return piece;
      return `${piece.split('=', 1)[0]}=`;
    })
    .join('&');
}
function sanitizeUrl(value: string): string {
  const clean = value.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?#]*@/i, '$1');
  const queryAt = clean.indexOf('?');
  const fragmentAt = clean.indexOf('#');
  if (queryAt < 0 || (fragmentAt >= 0 && fragmentAt < queryAt)) return clean;
  const end = fragmentAt < 0 ? clean.length : fragmentAt;
  return (
    clean.slice(0, queryAt + 1) +
    sanitizeEncodedFields(clean.slice(queryAt + 1, end)) +
    clean.slice(end)
  );
}
function redactStructuredBody(body: string): string {
  try {
    const data: unknown = JSON.parse(body);
    let changed = false;
    const redact = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(redact);
      if (value !== null && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => {
            if (!secretPattern.test(key)) return [key, redact(item)];
            const safe = typeof item === 'string' ? preservePlaceholder(item) : '';
            if (safe !== item) changed = true;
            return [key, safe];
          }),
        );
      return value;
    };
    const safe = redact(data);
    return changed ? JSON.stringify(safe, null, 2) : body;
  } catch {
    return body;
  }
}
export function sanitizeRequest(request: HttpRequest): HttpRequest {
  const clean = (items: KeyValue[]) =>
    items.map((x) => ({
      ...x,
      value: x.secret || secretPattern.test(x.key) ? preservePlaceholder(x.value) : x.value,
    }));
  const url = sanitizeUrl(request.url);
  return {
    ...request,
    url,
    headers: clean(request.headers),
    query: clean(request.query),
    body:
      request.bodyType === 'json'
        ? redactStructuredBody(request.body)
        : request.bodyType === 'form'
          ? sanitizeEncodedFields(request.body)
          : request.body,
    auth: {
      ...request.auth,
      token: preservePlaceholder(request.auth.token),
      password: preservePlaceholder(request.auth.password),
      value:
        request.auth.type === 'apiKey'
          ? preservePlaceholder(request.auth.value)
          : request.auth.value,
    },
  };
}
export function sanitizeWorkspace(workspace: Workspace): Workspace {
  return {
    ...workspace,
    saved: workspace.saved.map(sanitizeRequest),
    history: workspace.history
      .slice(0, 100)
      .map((x) => ({
        ...x,
        request: sanitizeRequest(x.request),
        error: x.error ? 'Request failed' : undefined,
      })),
    environments: workspace.environments.map((e) => ({
      ...e,
      variables: e.variables.map((v) => ({
        ...v,
        value: v.secret || secretPattern.test(v.key) ? preservePlaceholder(v.value) : v.value,
      })),
    })),
  };
}
export function initialWorkspace(): Workspace {
  const base = makeRequest();
  return {
    version: 1,
    folders: ['User API', 'Projects', 'Auth'],
    saved: [
      {
        ...base,
        name: 'List Users',
        folder: 'User API',
        url: '{{base_url}}/users',
        query: [
          row('_page', '1', 'Page number (starting from 1)'),
          row('_limit', '20', 'Number of users per page'),
        ],
        headers: [row('Accept', 'application/json', 'Expected response format')],
      },
      { ...makeRequest(), name: 'Get User by ID', folder: 'User API', url: '{{base_url}}/users/1' },
      {
        ...makeRequest(),
        name: 'Create User',
        method: 'POST',
        folder: 'User API',
        url: '{{base_url}}/users',
        bodyType: 'json',
        body: '{\n  "name": "Alex Morgan",\n  "email": "alex@example.com"\n}',
      },
      {
        ...makeRequest(),
        name: 'Update User',
        method: 'PUT',
        folder: 'User API',
        url: '{{base_url}}/users/1',
        bodyType: 'json',
        body: '{\n  "name": "Alex Morgan"\n}',
      },
      {
        ...makeRequest(),
        name: 'Delete User',
        method: 'DELETE',
        folder: 'User API',
        url: '{{base_url}}/users/1',
      },
    ],
    history: [],
    environments: [
      {
        id: 'development',
        name: 'Development',
        variables: [
          row(
            'base_url',
            'https://jsonplaceholder.typicode.com',
            'Example API. Writes are simulated by JSONPlaceholder.',
          ),
        ],
      },
      { id: 'local', name: 'Local', variables: [row('base_url', 'http://localhost:3000')] },
    ],
    activeEnvironmentId: 'development',
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}
function isPair(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    typeof value.value === 'string' &&
    typeof value.enabled === 'boolean' &&
    optionalString(value.id) &&
    optionalString(value.description) &&
    (value.secret === undefined || typeof value.secret === 'boolean')
  );
}
function isRequest(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !['id', 'name', 'method', 'url', 'body'].every((key) => typeof value[key] === 'string') ||
    !value.id ||
    !['none', 'json', 'text', 'form'].includes(String(value.bodyType)) ||
    typeof value.followRedirects !== 'boolean' ||
    typeof value.timeoutMs !== 'number' ||
    !Number.isFinite(value.timeoutMs) ||
    value.timeoutMs <= 0 ||
    value.timeoutMs > 300_000 ||
    !optionalString(value.folder) ||
    !Array.isArray(value.headers) ||
    !value.headers.every(isPair) ||
    !Array.isArray(value.query) ||
    !value.query.every(isPair) ||
    !isRecord(value.auth)
  )
    return false;
  const auth = value.auth;
  return (
    ['none', 'bearer', 'basic', 'apiKey'].includes(String(auth.type)) &&
    ['token', 'username', 'password', 'key', 'value'].every((key) => optionalString(auth[key])) &&
    (auth.location === undefined || auth.location === 'header' || auth.location === 'query')
  );
}
export function readWorkspace(value: unknown): Workspace | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.activeEnvironmentId !== 'string' ||
    !Array.isArray(value.saved) ||
    !value.saved.every(isRequest) ||
    !Array.isArray(value.folders) ||
    !value.folders.every((x) => typeof x === 'string') ||
    !Array.isArray(value.history) ||
    !value.history.every(
      (h) =>
        isRecord(h) &&
        typeof h.id === 'string' &&
        typeof h.createdAt === 'string' &&
        isRequest(h.request) &&
        optionalString(h.error) &&
        (h.status === undefined || typeof h.status === 'number') &&
        (h.durationMs === undefined || typeof h.durationMs === 'number'),
    ) ||
    !Array.isArray(value.environments) ||
    !value.environments.every(
      (e) =>
        isRecord(e) &&
        typeof e.id === 'string' &&
        typeof e.name === 'string' &&
        Array.isArray(e.variables) &&
        e.variables.every(isPair),
    )
  )
    return null;
  const workspace = value as unknown as Workspace;
  if (
    new Set(workspace.saved.map((r) => r.id)).size !== workspace.saved.length ||
    new Set(workspace.environments.map((e) => e.id)).size !== workspace.environments.length ||
    new Set(workspace.folders).size !== workspace.folders.length
  )
    return null;
  return workspace;
}
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
export function formatBytes(bytes: number) {
  return bytes < 1024
    ? `${bytes} B`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1048576).toFixed(1)} MB`;
}
