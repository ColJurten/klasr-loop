export function isSameOrigin(request: Request): boolean {
  try {
    return request.headers.get('origin') === new URL(process.env.NEXTAUTH_URL ?? '').origin;
  } catch {
    return false;
  }
}
