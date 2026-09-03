'use client';

import Image from 'next/image';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function StorageOnboarding() {
  const [open, setOpen] = useState(false);

  return (
    <section aria-labelledby="storage-title" className="mb-4 rounded-lg border border-peach-deep/35 bg-peach/25 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="storage-title" className="text-sm font-medium">Aucun stockage cloud connecté</h2>
          <p className="mt-1 text-sm text-ink/65">Connectez votre espace pour parcourir vos fichiers.</p>
        </div>
        <Button type="button" variant="secondary" aria-expanded={open} aria-controls="storage-providers" onClick={() => setOpen((value) => !value)}>
          Connecter
        </Button>
      </div>
      {open && (
        <div id="storage-providers" aria-label="Fournisseurs de stockage" className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={() => void signIn('google', { callbackUrl: '/dashboard' })} className="flex min-h-16 items-center gap-3 rounded-lg border border-[#4285F4] bg-white p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4285F4]">
            <Image src="/brands/google-drive.svg" alt="" width={32} height={32} />
            <span className="font-medium">Google Drive</span>
          </button>
          <button type="button" disabled className="flex min-h-16 items-center gap-3 rounded-lg border border-[#0078D4] bg-white p-3 text-left disabled:cursor-not-allowed">
            <Image src="/brands/onedrive.svg" alt="" width={32} height={32} />
            <span><span className="block font-medium">OneDrive</span><span className="text-xs text-ink/70">Bientôt disponible</span></span>
          </button>
        </div>
      )}
    </section>
  );
}
