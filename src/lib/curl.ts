import { buildUrl, interpolate, makeRequest, row, splitUrlQuery } from './model';
import type { HttpRequest } from './types';

const MAX_CURL_BYTES = 1_048_576;
const validMethod = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
export function tokenizeCurl(command: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let quote = '';
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === '\\' && quote !== "'") {
      const next = command[i + 1];
      if (next === undefined) throw new Error('The cURL command contains an unfinished escape.');
      if (next === '\n') {
        i++;
        continue;
      }
      // POSIX double quotes preserve backslashes before ordinary characters.
      if (quote === '"' && !['$', '`', '"', '\\'].includes(next)) {
        token += c;
        started = true;
        continue;
      }
      token += next;
      started = true;
      i++;
      continue;
    }
    if (quote) {
      if (c === quote) quote = '';
      else token += c;
      started = true;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      started = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (started) {
        tokens.push(token);
        token = '';
        started = false;
      }
    } else {
      token += c;
      started = true;
    }
  }
  if (quote) throw new Error('The cURL command contains an unfinished quote.');
  if (started) tokens.push(token);
  return tokens;
}

export function parseCurl(command: string): HttpRequest {
  if (new TextEncoder().encode(command).length > MAX_CURL_BYTES)
    throw new Error('cURL input is limited to 1 MiB.');
  const args = tokenizeCurl(command);
  if (args.shift() !== 'curl') throw new Error('Paste a command beginning with curl.');
  const request = makeRequest();
  request.name = 'Imported request';
  let explicitMethod: string | undefined;
  let get = false;
  let head = false;
  let json = false;
  let positional = false;
  const data: string[] = [];
  const withValue = new Set([
    '-X',
    '--request',
    '-H',
    '--header',
    '-d',
    '--data',
    '--data-raw',
    '--data-binary',
    '--data-urlencode',
    '--json',
    '-u',
    '--user',
    '-A',
    '--user-agent',
    '-e',
    '--referer',
    '--url',
    '-m',
    '--max-time',
  ]);
  const setUrl = (url: string) => {
    if (request.url)
      throw new Error('Import one URL at a time. Shell commands are never executed.');
    request.url = url;
  };
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--' && !positional) {
      positional = true;
      continue;
    }
    if (positional || !token.startsWith('-')) {
      setUrl(token);
      continue;
    }
    let flag = token;
    let inline: string | undefined;
    if (token.startsWith('--') && token.includes('=')) {
      const at = token.indexOf('=');
      flag = token.slice(0, at);
      inline = token.slice(at + 1);
    } else if (
      !token.startsWith('--') &&
      token.length > 2 &&
      ['-X', '-H', '-d', '-u', '-A', '-e', '-m'].includes(token.slice(0, 2))
    ) {
      flag = token.slice(0, 2);
      inline = token.slice(2);
    }
    let value = '';
    if (withValue.has(flag)) {
      value = inline ?? args[++i];
      if (value === undefined) throw new Error(`Missing value after ${flag}.`);
    } else if (inline !== undefined) throw new Error(`${flag} does not accept a value.`);
    if (flag === '-X' || flag === '--request') {
      explicitMethod = value.toUpperCase();
      if (!validMethod.test(explicitMethod)) throw new Error('The HTTP method is invalid.');
    } else if (flag === '-H' || flag === '--header') {
      const at = value.indexOf(':');
      if (at < 1 || !value.slice(0, at).trim())
        throw new Error('Headers must use “Name: value”. File references are not supported.');
      request.headers.push(row(value.slice(0, at).trim(), value.slice(at + 1).trimStart()));
    } else if (['-d', '--data', '--data-raw', '--data-binary', '--json'].includes(flag)) {
      if (value.startsWith('@') && flag !== '--data-raw')
        throw new Error('File references are not supported. Paste the file content instead.');
      if (flag === '--json') json = true;
      data.push(value);
    } else if (flag === '--data-urlencode') {
      const at = value.indexOf('=');
      const encode = (text: string) => new URLSearchParams([['', text]]).toString().slice(1);
      if (at >= 0) data.push((at ? `${value.slice(0, at)}=` : '') + encode(value.slice(at + 1)));
      else {
        if (value.includes('@')) throw new Error('File-based --data-urlencode is not supported.');
        data.push(encode(value));
      }
    } else if (flag === '-u' || flag === '--user') {
      const at = value.indexOf(':');
      if (at < 0)
        throw new Error(
          'Use --user username:password. Interactive password prompts are unsupported.',
        );
      request.auth = { type: 'basic', username: value.slice(0, at), password: value.slice(at + 1) };
    } else if (flag === '-A' || flag === '--user-agent')
      request.headers.push(row('User-Agent', value));
    else if (flag === '-e' || flag === '--referer') request.headers.push(row('Referer', value));
    else if (flag === '--url') setUrl(value);
    else if (flag === '-L' || flag === '--location') request.followRedirects = true;
    else if (flag === '-I' || flag === '--head') head = true;
    else if (flag === '-G' || flag === '--get') get = true;
    else if (flag === '-m' || flag === '--max-time') {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300)
        throw new Error('cURL max-time must be greater than zero and at most 300 seconds.');
      request.timeoutMs = Math.ceil(seconds * 1000);
    } else if (
      [
        '-s',
        '--silent',
        '-S',
        '--show-error',
        '-sS',
        '--compressed',
        '-g',
        '--globoff',
        '-i',
        '--include',
        '--no-progress-meter',
      ].includes(flag)
    )
      continue;
    else if (flag === '-k' || flag === '--insecure')
      throw new Error('TLS certificate verification cannot be disabled.');
    else
      throw new Error(
        `Unsupported cURL option: ${flag}. Remove it or configure the request manually.`,
      );
  }
  if (!request.url) throw new Error('This command has no URL.');
  if (!/^https?:\/\//i.test(request.url) && !request.url.includes('{{'))
    throw new Error('The URL must start with http:// or https://.');
  if (head && data.length && !get)
    throw new Error('Combining --head and a request body is unsupported.');
  request.method = explicitMethod ?? (head ? 'HEAD' : get || !data.length ? 'GET' : 'POST');
  const body = data.join(json ? '' : '&');
  if (get && data.length) {
    const fragmentAt = request.url.indexOf('#');
    const base = fragmentAt < 0 ? request.url : request.url.slice(0, fragmentAt);
    const fragment = fragmentAt < 0 ? '' : request.url.slice(fragmentAt);
    request.url = `${base}${base.includes('?') ? '&' : '?'}${body}${fragment}`;
  } else if (data.length) {
    request.body = body;
    request.bodyType =
      json ||
      request.headers.some((h) => h.key.toLowerCase() === 'content-type' && /json/i.test(h.value))
        ? 'json'
        : 'form';
    if (!request.headers.some((h) => h.key.toLowerCase() === 'content-type'))
      request.headers.push(
        row('Content-Type', json ? 'application/json' : 'application/x-www-form-urlencoded'),
      );
  }
  if (json && !request.headers.some((h) => h.key.toLowerCase() === 'accept'))
    request.headers.push(row('Accept', 'application/json'));
  const split = splitUrlQuery(request.url);
  request.url = split.url;
  request.query = split.query;
  return request;
}

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
export function toCurl(request: HttpRequest, environment: Record<string, string>): string {
  if (!validMethod.test(request.method)) throw new Error('The HTTP method is invalid.');
  const parts = ['curl', '-X', quote(request.method), quote(buildUrl(request, environment))];
  const headers = request.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h) => ({
      key: interpolate(h.key, environment),
      value: interpolate(h.value, environment),
    }));
  const setHeader = (key: string, value: string) => {
    for (let i = headers.length - 1; i >= 0; i--)
      if (headers[i].key.toLowerCase() === key.toLowerCase()) headers.splice(i, 1);
    headers.push({ key, value });
  };
  if (request.auth.type === 'bearer')
    setHeader('Authorization', `Bearer ${interpolate(request.auth.token ?? '', environment)}`);
  if (request.auth.type === 'basic') {
    for (let i = headers.length - 1; i >= 0; i--)
      if (headers[i].key.toLowerCase() === 'authorization') headers.splice(i, 1);
    const username = interpolate(request.auth.username ?? '', environment);
    if (username.includes(':'))
      throw new Error('Basic authentication usernames cannot contain a colon.');
    parts.push('-u', quote(`${username}:${interpolate(request.auth.password ?? '', environment)}`));
  }
  if (request.auth.type === 'apiKey' && request.auth.location !== 'query') {
    const key = interpolate(request.auth.key ?? '', environment);
    if (!key.trim()) throw new Error('The API key header name is empty.');
    setHeader(key, interpolate(request.auth.value ?? '', environment));
  }
  if (request.bodyType !== 'none' && !headers.some((h) => h.key.toLowerCase() === 'content-type')) {
    setHeader(
      'Content-Type',
      request.bodyType === 'json'
        ? 'application/json'
        : request.bodyType === 'form'
          ? 'application/x-www-form-urlencoded'
          : 'text/plain',
    );
  }
  for (const h of headers) parts.push('-H', quote(`${h.key}: ${h.value}`));
  if (request.bodyType !== 'none')
    parts.push('--data-raw', quote(interpolate(request.body, environment)));
  if (request.followRedirects) parts.push('--location');
  parts.push('--max-time', String(request.timeoutMs / 1000));
  return parts.join(' \\\n  ');
}
