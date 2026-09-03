'use client';

import { LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl: '/login' })}
      className="mt-3 flex items-center gap-2 text-xs text-ink/60 transition-colors hover:text-ink"
    >
      <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
      Se déconnecter
    </button>
  );
}
