'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCcw } from 'lucide-react';
import { startSync } from '@/lib/client-api';
import { Button } from '@/components/ui/button';

export function SyncButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'error'>('idle');

  async function handleClick() {
    if (disabled || state === 'running') return;
    setState('running');
    try {
      await startSync();
      router.refresh();
      setState('idle');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button type="button" variant="secondary" disabled={disabled || state === 'running'} onClick={() => void handleClick()}>
        <RefreshCcw className="mr-1.5 inline h-3.5 w-3.5" strokeWidth={1.5} />
        {state === 'running' ? 'Synchronisation...' : 'Synchroniser'}
      </Button>
      {state === 'error' && <p className="text-xs text-peach-deep">Synchronisation échouée.</p>}
    </div>
  );
}
