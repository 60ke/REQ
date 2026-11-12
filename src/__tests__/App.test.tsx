// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import * as bridge from '../lib/bridge';
import { makeRequest, row } from '../lib/model';
import type { HttpResponse } from '../lib/types';
vi.mock('../lib/bridge', () => ({
  isDesktop: () => false,
  loadWorkspace: vi.fn(async () => null),
  saveWorkspace: vi.fn(async () => {}),
  executeRequest: vi.fn(),
  cancelRequest: vi.fn(async () => {}),
  importCurl: vi.fn(),
  exportCurl: vi.fn(),
  downloadText: vi.fn(),
}));
const result: HttpResponse = {
  requestId: 'test',
  status: 200,
  statusText: 'OK',
  headers: [{ key: 'content-type', value: 'application/json' }],
  body: '{"data":[{"name":"Ada"}]}',
  durationMs: 24,
  sizeBytes: 25,
  url: 'https://example.com/users',
  truncated: false,
  contentType: 'application/json',
};
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(bridge.loadWorkspace).mockResolvedValue(null);
  vi.mocked(bridge.executeRequest).mockResolvedValue(result);
});
afterEach(() => cleanup());
async function mount() {
  render(<App />);
  await waitFor(() => expect(bridge.loadWorkspace).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });
}
describe('request workspace UI', () => {
  it('starts with the approved layout and an honest empty response', async () => {
    await mount();
    expect(screen.getByRole('button', { name: 'New Request' })).toBeTruthy();
    expect(screen.getByText('Ready when you are')).toBeTruthy();
    expect(screen.queryByText('200 OK')).toBeNull();
    expect(screen.getByLabelText('Request URL')).toHaveProperty('value', '{{base_url}}/users');
    expect(screen.getByText(/Browser preview/)).toBeTruthy();
  });
  it('sends edited enabled params and displays only the actual returned response', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('parameter value 1'), { target: { value: '4' } });
    fireEvent.click(screen.getByLabelText('Enable parameter 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('200 OK');
    expect(bridge.executeRequest).toHaveBeenCalledTimes(1);
    const [req, env] = vi.mocked(bridge.executeRequest).mock.calls[0];
    expect(req.query.map((x) => [x.value, x.enabled])).toEqual([
      ['4', true],
      ['20', false],
    ]);
    expect(env.base_url).toBe('https://jsonplaceholder.typicode.com');
    expect(screen.getByText('"Ada"')).toBeTruthy();
    expect(screen.getByText('24 ms')).toBeTruthy();
  });
  it('imports URL query parameters once, without repeated accumulation', async () => {
    await mount();
    const url = screen.getByLabelText('Request URL');
    fireEvent.change(url, { target: { value: 'https://example.com/test?tag=a&tag=b' } });
    fireEvent.blur(url);
    expect(url).toHaveProperty('value', 'https://example.com/test');
    expect(screen.getByLabelText('parameter value 3')).toHaveProperty('value', 'a');
    expect(screen.getByLabelText('parameter value 4')).toHaveProperty('value', 'b');
    fireEvent.blur(url);
    expect(screen.queryByLabelText('parameter value 5')).toBeNull();
  });
  it('does not double-send while an earlier request is pending and cancels explicitly', async () => {
    let reject!: (e: Error) => void;
    vi.mocked(bridge.executeRequest).mockImplementation(
      () =>
        new Promise((_res, rej) => {
          reject = rej;
        }),
    );
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Sending request');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(bridge.executeRequest).toHaveBeenCalledTimes(1);
    expect(bridge.cancelRequest).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Request canceled.')));
    await screen.findByText('Request canceled.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('supports editable auth and body with exact raw text sent to the transport', async () => {
    await mount();
    openTab('Body');
    fireEvent.click(screen.getByLabelText('JSON'));
    const raw = '{ "message": "hello", "n": 1 }\n';
    fireEvent.change(screen.getByLabelText('Request body'), { target: { value: raw } });
    openTab('Auth');
    fireEvent.change(screen.getByLabelText('Authorization type'), { target: { value: 'bearer' } });
    fireEvent.change(screen.getByLabelText('Bearer token'), {
      target: { value: '{{access_token}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('200 OK');
    expect(vi.mocked(bridge.executeRequest).mock.calls[0][0]).toMatchObject({
      body: raw,
      bodyType: 'json',
      auth: { type: 'bearer', token: '{{access_token}}' },
    });
  });
  it('requires an explicit discard when closing an edited request', async () => {
    await mount();
    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://example.com/changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close List Users' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Request URL')).toHaveProperty(
      'value',
      'https://example.com/changed',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close List Users' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close without saving' }));
    expect(screen.getByLabelText('Request URL')).toHaveProperty('value', '');
  });
  it('saves a request by name and can reopen it from search', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'New Request' }));
    fireEvent.change(screen.getByLabelText('Request URL'), {
      target: { value: 'https://example.com/check' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save request' }));
    const modal = screen.getByRole('dialog');
    fireEvent.change(within(modal).getByLabelText('Request name'), {
      target: { value: 'Health check' },
    });
    fireEvent.click(within(modal).getByRole('button', { name: 'Save request' }));
    await screen.findByText('Request saved locally. Credentials stay in this session.');
    fireEvent.change(screen.getByLabelText('Search requests'), { target: { value: 'health' } });
    expect(screen.getByRole('button', { name: /GET Health check/ })).toBeTruthy();
  });
  it('does not overwrite existing persisted data after a load failure', async () => {
    vi.mocked(bridge.loadWorkspace).mockRejectedValue(new Error('Invalid workspace JSON'));
    await mount();
    await screen.findByText(/Your workspace could not be loaded/);
    expect(screen.getByText(/Local saving paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    expect(bridge.saveWorkspace).not.toHaveBeenCalled();
    expect(screen.getByText('Local saving is paused')).toBeTruthy();
  });
  it('imports a reviewed cURL request and never sends it automatically', async () => {
    const imported = {
      ...makeRequest(),
      method: 'POST',
      url: 'https://example.com/new',
      headers: [row('Accept', 'application/json')],
      name: 'Imported request',
    };
    vi.mocked(bridge.importCurl).mockResolvedValue(imported);
    await mount();
    fireEvent.click(screen.getByLabelText('Send options'));
    fireEvent.click(screen.getByRole('button', { name: 'Import cURL' }));
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: { value: 'curl https://example.com/new -X POST' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import request' }));
    await screen.findByText('cURL imported. Review the request before sending.');
    expect(screen.getByLabelText('HTTP method')).toHaveProperty('value', 'POST');
    expect(bridge.executeRequest).not.toHaveBeenCalled();
  });
  it('does not reopen a request when a pending import is dismissed', async () => {
    let resolve!: (value: ReturnType<typeof makeRequest>) => void;
    vi.mocked(bridge.importCurl).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await mount();
    fireEvent.click(screen.getByLabelText('Send options'));
    fireEvent.click(screen.getByRole('button', { name: 'Import cURL' }));
    fireEvent.change(screen.getByLabelText('cURL command'), {
      target: { value: 'curl https://example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import request' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await act(async () => {
      resolve({ ...makeRequest(), name: 'Late import', url: 'https://example.com' });
    });
    expect(screen.queryByRole('tab', { name: /Late import/ })).toBeNull();
    expect(screen.queryByText('cURL imported. Review the request before sending.')).toBeNull();
    expect(screen.getByLabelText('Request URL')).toHaveProperty('value', '{{base_url}}/users');
  });
  it('uses the response action menu to save the actual body and changes syntax views', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('200 OK');
    fireEvent.click(screen.getByRole('button', { name: 'Save Response' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save raw response' }));
    expect(bridge.downloadText).toHaveBeenCalledWith(
      'response-200.json',
      result.body,
      'application/json',
    );
    fireEvent.change(screen.getByLabelText('Response syntax'), { target: { value: 'text' } });
    expect(document.querySelector('.token-string')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand response' }));
    expect(screen.queryByLabelText('Request URL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore request editor' }));
    expect(screen.getByLabelText('Request URL')).toBeTruthy();
  });
  it('clearly marks AI unavailable and offers local cURL import instead', async () => {
    await mount();
    fireEvent.click(screen.getByLabelText('AI assistance'));
    expect(screen.getByText(/AI assistance is not connected/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import cURL' }));
    expect(screen.getByRole('heading', { name: 'Import from cURL' })).toBeTruthy();
  });
});
