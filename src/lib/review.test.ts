import { describe, expect, it } from 'vitest';
import {
  initialWorkspace,
  interpolate,
  makeRequest,
  readWorkspace,
  row,
  sanitizeRequest,
} from './model';
import { parseCurl, toCurl, tokenizeCurl } from './curl';

describe('independent security and fidelity regressions', () => {
  it('preserves non-secret raw JSON bytes when saving and redacts known secrets', () => {
    const body = '{  "name": "Ada", "n": 1 }\n';
    expect(sanitizeRequest({ ...makeRequest(), bodyType: 'json', body }).body).toBe(body);
    expect(
      sanitizeRequest({ ...makeRequest(), bodyType: 'json', body: '{ "password": "secret" }' })
        .body,
    ).not.toContain('secret');
  });

  it('preserves the query before the URL fragment while stripping recognized secrets', () => {
    const clean = sanitizeRequest({
      ...makeRequest(),
      url: 'https://example.com/a?keep=one&token=secret#section',
    });
    const url = new URL(clean.url);
    expect(url.searchParams.get('keep')).toBe('one');
    expect(url.searchParams.get('token')).toBe('');
    expect(url.hash).toBe('#section');
    expect(clean.url).not.toContain('secret');
  });

  it('does not persist credentials embedded in a URL', () => {
    const clean = sanitizeRequest({
      ...makeRequest(),
      url: 'https://alice:secret@example.com/private',
    });
    expect(new URL(clean.url).password).toBe('');
    expect(clean.url).not.toContain('secret');
  });

  it('preserves a Bearer environment reference in a saved header', () => {
    const clean = sanitizeRequest({
      ...makeRequest(),
      headers: [row('Authorization', 'Bearer {{token}}')],
    });
    expect(clean.headers[0].value).toBe('Bearer {{token}}');
  });

  it('allows defined empty environment values and never expands them recursively', () => {
    expect(interpolate('a{{empty}}b', { empty: '' })).toBe('ab');
    expect(interpolate('{{one}}', { one: '{{two}}', two: 'secret' })).toBe('{{two}}');
  });

  it('rejects missing, unclosed, empty and inherited environment variables', () => {
    for (const value of ['{{missing}}', '{{unfinished', '{{}}', '{{toString}}']) {
      expect(() => interpolate(value, {})).toThrow();
    }
  });

  it('preserves shell backslashes that have no special meaning within double quotes', () => {
    expect(tokenizeCurl(String.raw`curl "https://example.com/a?q=\q"`)).toEqual([
      'curl',
      String.raw`https://example.com/a?q=\q`,
    ]);
  });

  it('roundtrips exported multiline cURL without introducing empty arguments', () => {
    const request = {
      ...makeRequest(),
      url: 'https://example.com/a',
      method: 'POST',
      bodyType: 'json' as const,
      body: '{"name":"Ada"}',
    };
    const imported = parseCurl(toCurl(request, {}));
    expect(imported.url).toBe(request.url);
    expect(imported.method).toBe(request.method);
    expect(imported.body).toBe(request.body);
  });

  it('exports the effective auth header rather than both overridden and active values', () => {
    const request = {
      ...makeRequest(),
      url: 'https://example.com',
      headers: [row('Authorization', 'old-token')],
      auth: { type: 'bearer' as const, token: 'new-token' },
    };
    const imported = parseCurl(toCurl(request, {}));
    const authorization = imported.headers.filter((h) => h.key.toLowerCase() === 'authorization');
    expect(authorization.map((h) => h.value)).toEqual(['Bearer new-token']);
  });

  it('does not export a request method as executable shell syntax', () => {
    const method = 'GET; touch /tmp/req-test-must-not-execute';
    const request = { ...makeRequest(), method, url: 'https://example.com' };
    let command: string;
    try {
      command = toCurl(request, {});
    } catch {
      return;
    }
    expect(tokenizeCurl(command)[2]).toBe(method);
  });

  it('models repeated --json as concatenation and includes its Accept header', () => {
    const request = parseCurl(`curl https://example.com --json '{"a":' --json '1}'`);
    expect(request.body).toBe('{"a":1}');
    expect(
      request.headers.some(
        (h) => h.key.toLowerCase() === 'accept' && h.value === 'application/json',
      ),
    ).toBe(true);
  });

  it('never imports filesystem references as literal request data', () => {
    expect(() => parseCurl('curl https://example.com --data-binary @/etc/passwd')).toThrow();
    expect(parseCurl('curl https://example.com --data-raw @literal').body).toBe('@literal');
  });

  it('rejects invalid persisted row values before rendering', () => {
    const workspace = initialWorkspace();
    (workspace.environments[0].variables[0] as unknown as { value: number }).value = 42;
    expect(readWorkspace(workspace)).toBeNull();
  });
});
