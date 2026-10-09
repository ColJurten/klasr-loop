import { NextResponse } from 'next/server';
import { apiUrl, sessionTenant, internalHeaders } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export async function GET(request: Request, { params }: { params: { fileId: string } }) {
  const { fileId } = params;
  const variant = new URL(request.url).searchParams.get('variant');
  if (!fileId || fileId.length > 512 || (variant !== null && variant !== 'content' && variant !== 'thumbnail')) {
    return NextResponse.json({ error: 'Invalid Drive preview parameters' }, { status: 400 });
  }
  try {
    const { organizationId, userId } = await sessionTenant();
    const variantQuery = variant ? `?variant=${variant}` : '';
    const response = await fetch(`${apiUrl()}/organizations/${organizationId}/drive/files/${encodeURIComponent(fileId)}/preview${variantQuery}`, {
      headers: internalHeaders(userId), cache: 'no-store',
    });
    if (!response.ok) {
      return NextResponse.json({ error: 'Drive preview unavailable' }, { status: response.status, headers: { 'Cache-Control': 'no-store' } });
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!INLINE_TYPES.has(contentType.split(';')[0].trim().toLowerCase())) {
      await response.body?.cancel();
      return NextResponse.json({ error: 'Unsupported preview content type' }, { status: 415, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    const headers = new Headers({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    headers.set('Content-Type', contentType);
    const disposition = response.headers.get('content-disposition');
    if (disposition) headers.set('Content-Disposition', disposition);
    return new NextResponse(response.body, { headers });
  } catch (error) {
    return bffErrorResponse(error, 'Drive preview failed');
  }
}
