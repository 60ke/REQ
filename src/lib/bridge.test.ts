import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { cancelRequest, executeRequest, loadWorkspace, saveWorkspace } from './bridge';
import { initialWorkspace, makeRequest } from './model';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

let stored: Map<string, string>;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  stored = new Map();
  fetchMock.mockReset();
  vi.mocked(invoke).mockReset();
  vi.stubGlobal('window', {});
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
const pendingFetch = () =>
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        );
      }),
  );

describe('browser request safety', () => {
  it('blocks automatic redirects before any HTTP request', async () => {
    await expect(
      executeRequest({ ...makeRequest(), url: 'https://example.com', followRedirects: true }, {}),
    ).rejects.toThrow('desktop app');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('sends effective auth and encoded params while treating HTTP errors as responses', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"ok":false}', {
        status: 418,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const response = await executeRequest(
      {
        ...makeRequest(),
        url: 'https://example.com',
        auth: { type: 'bearer', token: '{{token}}' },
        headers: [{ key: 'Authorization', value: 'old', enabled: true }],
        query: [{ key: 'q', value: 'a & b', enabled: true }],
      },
      { token: 'new' },
    );
    expect(response.status).toBe(418);
    expect(response.body).toBe('{"ok":false}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('q=a+%26+b');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer new');
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
  });
  it('rejects empty GET bodies explicitly rather than leaving a browser fetch error', async () => {
    await expect(
      executeRequest({ ...makeRequest(), url: 'https://example.com', bodyType: 'json' }, {}),
    ).rejects.toThrow('GET or HEAD bodies');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('cancels pending requests and releases IDs without losing an active controller', async () => {
    pendingFetch();
    const request = { ...makeRequest(), url: 'https://example.com' };
    const first = executeRequest(request, {});
    const rejected = expect(first).rejects.toThrow('canceled');
    await expect(executeRequest(request, {})).rejects.toThrow('already running');
    await cancelRequest(request.id);
    await rejected;
    fetchMock.mockResolvedValue(new Response('retry ok'));
    expect((await executeRequest(request, {})).body).toBe('retry ok');
  });
  it('times out pending requests', async () => {
    pendingFetch();
    await expect(
      executeRequest({ ...makeRequest(), url: 'https://example.com', timeoutMs: 5 }, {}),
    ).rejects.toThrow('timed out');
  });
  it('caps captured response bytes and marks truncation', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array(5 * 1024 * 1024 + 1)));
    const response = await executeRequest({ ...makeRequest(), url: 'https://example.com' }, {});
    expect(response.sizeBytes).toBe(5 * 1024 * 1024);
    expect(response.truncated).toBe(true);
  });
});

describe('workspace recovery', () => {
  it('distinguishes missing data from invalid data without overwriting either', async () => {
    expect(await loadWorkspace()).toBeNull();
    stored.set('req.workspace.v1', '{bad');
    await expect(loadWorkspace()).rejects.toThrow('not valid JSON');
    expect(stored.get('req.workspace.v1')).toBe('{bad');
    stored.set('req.workspace.v1', '{}');
    await expect(loadWorkspace()).rejects.toThrow('invalid or unsupported');
    expect(stored.get('req.workspace.v1')).toBe('{}');
  });
});

describe('native bridge contract', () => {
  it('passes camelCase request and cancellation arguments to Tauri', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const request = { ...makeRequest(), url: 'https://example.com' };
    const environment = { token: 'session-value' };
    vi.mocked(invoke).mockResolvedValue({ status: 200 });
    await executeRequest(request, environment);
    expect(invoke).toHaveBeenCalledWith('execute_request', { request, environment });
    await cancelRequest(request.id);
    expect(invoke).toHaveBeenCalledWith('cancel_request', { requestId: request.id });
  });
  it('serializes native saves and persists filtered snapshots', async () => {
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    const releases: Array<() => void> = [];
    vi.mocked(invoke).mockImplementation(
      () => new Promise((resolve) => releases.push(() => resolve(undefined))),
    );
    const firstWorkspace = initialWorkspace();
    firstWorkspace.saved[0].auth = { type: 'bearer', token: 'never-on-disk' };
    const first = saveWorkspace(firstWorkspace);
    const nextWorkspace = { ...initialWorkspace(), folders: ['latest'] };
    const second = saveWorkspace(nextWorkspace);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'save_workspace',
      expect.objectContaining({
        workspace: expect.objectContaining({
          saved: expect.arrayContaining([
            expect.objectContaining({ auth: expect.objectContaining({ token: '' }) }),
          ]),
        }),
      }),
    );
    releases[0]();
    await first;
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'save_workspace',
      expect.objectContaining({ workspace: expect.objectContaining({ folders: ['latest'] }) }),
    );
    releases[1]();
    await second;
  });
});
