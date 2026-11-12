import { invoke } from '@tauri-apps/api/core';
import { buildUrl, interpolate, readWorkspace, sanitizeWorkspace } from './model';
import { parseCurl, toCurl } from './curl';
import type { HttpRequest, HttpResponse, Workspace } from './types';

export const isDesktop = () => '__TAURI_INTERNALS__' in window;
const storageKey = 'req.workspace.v1';
const controllers = new Map<string, AbortController>();
const maxWorkspaceBytes = 5 * 1024 * 1024;
const byteLength = (value: string) => new TextEncoder().encode(value).length;

export async function loadWorkspace(): Promise<Workspace | null> {
  let raw: unknown;
  if (isDesktop()) raw = await invoke('load_workspace');
  else {
    const text = localStorage.getItem(storageKey);
    if (text === null) return null;
    if (byteLength(text) > maxWorkspaceBytes)
      throw new Error('The saved workspace exceeds 5 MiB. It has not been overwritten.');
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('The saved workspace is not valid JSON. It has not been overwritten.');
    }
  }
  if (raw === null) return null;
  const workspace = readWorkspace(raw);
  if (!workspace)
    throw new Error(
      'The saved workspace has an invalid or unsupported format. It has not been overwritten.',
    );
  return sanitizeWorkspace(workspace);
}
let pendingSave: Promise<void> = Promise.resolve();
export function saveWorkspace(workspace: Workspace): Promise<void> {
  // Capture this version immediately and serialize writes. A slower older save
  // must not finish after, and replace, a newer workspace.
  const safe = sanitizeWorkspace(workspace);
  const desktop = isDesktop();
  const write = async () => {
    if (desktop) {
      await invoke('save_workspace', { workspace: safe });
      return;
    }
    const encoded = JSON.stringify(safe);
    if (byteLength(encoded) > maxWorkspaceBytes)
      throw new Error('The workspace exceeds 5 MiB. Remove older history entries and try again.');
    localStorage.setItem(storageKey, encoded);
  };
  const result = pendingSave.then(write, write);
  pendingSave = result.catch(() => undefined);
  return result;
}

export async function executeRequest(
  request: HttpRequest,
  environment: Record<string, string>,
): Promise<HttpResponse> {
  if (isDesktop()) return invoke('execute_request', { request, environment });
  if (request.followRedirects)
    throw new Error(
      'Safe redirect following requires the desktop app. Turn off Follow redirects to send this request in browser preview.',
    );
  if (controllers.has(request.id))
    throw new Error('This request is already running. Cancel it or wait for it to finish.');
  if (request.headers.length > 1000 || request.query.length > 1000)
    throw new Error('Requests are limited to 1,000 headers and 1,000 query parameters.');
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(request.method))
    throw new Error('The HTTP method is invalid.');
  const url = buildUrl(request, environment);
  if (byteLength(url) > 65536) throw new Error('The URL is too long (maximum 64 KiB).');
  const headers = new Headers();
  let headerBytes = 0;
  for (const field of request.headers)
    if (field.enabled && field.key.trim()) {
      const key = interpolate(field.key, environment),
        value = interpolate(field.value, environment);
      headerBytes += byteLength(key) + byteLength(value);
      if (headerBytes > 256 * 1024) throw new Error('Request headers are limited to 256 KiB.');
      headers.append(key, value);
    }
  if (request.auth.type === 'bearer')
    headers.set('Authorization', `Bearer ${interpolate(request.auth.token ?? '', environment)}`);
  if (request.auth.type === 'basic') {
    const username = interpolate(request.auth.username ?? '', environment);
    if (username.includes(':'))
      throw new Error('Basic authentication usernames cannot contain a colon.');
    const credentials = `${username}:${interpolate(request.auth.password ?? '', environment)}`;
    const bytes = new TextEncoder().encode(credentials);
    headers.set(
      'Authorization',
      `Basic ${btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join(''))}`,
    );
  }
  if (request.auth.type === 'apiKey' && request.auth.location !== 'query') {
    const key = interpolate(request.auth.key ?? '', environment);
    if (!key.trim()) throw new Error('The API key header name is empty.');
    headers.set(key, interpolate(request.auth.value ?? '', environment));
  }
  if (request.bodyType !== 'none' && !headers.has('Content-Type'))
    headers.set(
      'Content-Type',
      request.bodyType === 'json'
        ? 'application/json'
        : request.bodyType === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'text/plain',
    );
  if (['GET', 'HEAD'].includes(request.method.toUpperCase()) && request.bodyType !== 'none')
    throw new Error(
      'Browser preview cannot send GET or HEAD bodies. Choose None in Body or use the desktop app.',
    );
  const body = request.bodyType === 'none' ? undefined : interpolate(request.body, environment);
  if (body !== undefined && byteLength(body) > 10 * 1024 * 1024)
    throw new Error('Request bodies are limited to 10 MiB.');
  const timeoutMs = Math.min(
    300_000,
    Math.max(1, Number.isFinite(request.timeoutMs) ? request.timeoutMs : 30_000),
  );
  const controller = new AbortController();
  controllers.set(request.id, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const start = performance.now();
  try {
    // Browsers cannot inspect redirect destinations before forwarding custom
    // credential headers. Reject redirects instead of leaking those headers.
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
      redirect: 'error',
      credentials: 'omit',
    });
    const maxBytes = 5 * 1024 * 1024;
    const chunks: Uint8Array[] = [];
    let sizeBytes = 0;
    let truncated = false;
    const reader = response.body?.getReader();
    if (reader)
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (sizeBytes + value.length > maxBytes) {
          chunks.push(value.slice(0, maxBytes - sizeBytes));
          sizeBytes = maxBytes;
          truncated = true;
          await reader.cancel();
          break;
        }
        chunks.push(value);
        sizeBytes += value.length;
      }
    const joined = new Uint8Array(sizeBytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return {
      requestId: request.id,
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers].map(([key, value]) => ({ key, value })),
      body: new TextDecoder().decode(joined),
      durationMs: Math.round(performance.now() - start),
      sizeBytes,
      url: response.url,
      truncated,
      contentType: response.headers.get('content-type') ?? '',
    };
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(
        timedOut ? `Request timed out after ${timeoutMs / 1000} seconds.` : 'Request canceled.',
      );
    if (error instanceof TypeError)
      throw new Error(
        'The browser could not reach this URL. CORS, a blocked redirect, TLS, or the connection may be responsible. The desktop app uses native HTTP and is not limited by browser CORS.',
      );
    throw error;
  } finally {
    clearTimeout(timer);
    if (controllers.get(request.id) === controller) controllers.delete(request.id);
  }
}
export async function cancelRequest(requestId: string): Promise<void> {
  if (isDesktop()) await invoke('cancel_request', { requestId });
  else controllers.get(requestId)?.abort();
}
export async function importCurl(curl: string): Promise<HttpRequest> {
  return isDesktop() ? invoke('import_curl', { curl }) : parseCurl(curl);
}
export async function exportCurl(
  request: HttpRequest,
  environment: Record<string, string>,
): Promise<string> {
  return isDesktop()
    ? invoke('export_curl', { request, environment })
    : toCurl(request, environment);
}
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
