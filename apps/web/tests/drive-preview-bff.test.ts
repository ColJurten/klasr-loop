import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api', () => ({
  apiUrl: () => 'http://api.test',
  sessionTenant: vi.fn().mockResolvedValue({ organizationId: 'org', userId: 'user' }),
  internalHeaders: () => ({ 'x-internal-secret': 'synthetic', 'x-user-id': 'user' }),
}));
import { GET } from '@/app/api/drive/preview/[fileId]/route';

describe('Drive preview BFF', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  it.each(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'])('passes %s through with no-store, nosniff and session identity', async (mime) => {
    const upstream = new Response('synthetic', { headers: { 'content-type': mime, 'content-disposition': 'inline' } });
    const body = upstream.body;
    vi.mocked(fetch).mockResolvedValue(upstream);
    const response = await GET(new Request('http://web.test/api/drive/preview/doc?variant=content'), { params: { fileId: 'doc' } });
    expect(response.body).toBe(body);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe(mime);
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('synthetic');
    expect(fetch).toHaveBeenCalledWith('http://api.test/organizations/org/drive/files/doc/preview?variant=content', {
      headers: { 'x-internal-secret': 'synthetic', 'x-user-id': 'user' }, cache: 'no-store',
    });
  });
  it.each(['text/html', 'image/svg+xml', 'application/octet-stream'])('rejects unsafe upstream %s', async (mime) => {
    vi.mocked(fetch).mockResolvedValue(new Response('sensitive synthetic payload', { headers: { 'content-type': mime } }));
    const response = await GET(new Request('http://web.test/preview'), { params: { fileId: 'doc' } });
    expect(response.status).toBe(415);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).not.toContain('sensitive');
  });
  it.each([['x'.repeat(513), ''], ['doc', '?variant=invalid'], ['doc', '?variant=']])('rejects invalid parameters', async (fileId, query) => {
    expect((await GET(new Request('http://web.test/preview' + query), { params: { fileId } })).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not expose upstream error content', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('sensitive synthetic payload', { status: 502 }));
    const response = await GET(new Request('http://web.test/preview'), { params: { fileId: 'doc' } });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('sensitive');
  });
});
