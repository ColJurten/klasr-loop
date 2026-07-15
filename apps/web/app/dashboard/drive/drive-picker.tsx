'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';

// Google's Picker API ships no official TypeScript types and no npm package —
// it's a globally loaded script (see GOOGLE_PICKER_SRC below). `any` is
// contained to this one file at the boundary where we touch window.gapi /
// window.google; everything we actually read from its callback is typed.
interface PickerCallbackData {
  action: string;
  docs?: { id: string; name: string }[];
}

const GOOGLE_PICKER_SRC = 'https://apis.google.com/js/api.js';

export function DrivePicker() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [pickerReady, setPickerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/drive/pending-token')
      .then((response) => {
        if (!response.ok) throw new Error('pending-token failed');
        return response.json() as Promise<{ accessToken: string }>;
      })
      .then((data) => setAccessToken(data.accessToken))
      .catch(() => setError("Impossible de récupérer l'autorisation. Recommencez la connexion."));
  }, []);

  function openPicker() {
    if (!accessToken) return;
    const google = (window as any).google;

    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setSelectFolderEnabled(true)
      .setIncludeFolders(true);

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setCallback(async (data: PickerCallbackData) => {
        if (data.action !== google.picker.Action.PICKED) return;
        const folder = data.docs?.[0];
        if (!folder) return;

        setSaving(true);
        try {
          const response = await fetch('/api/drive/finalize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rootFolder: { externalId: folder.id, name: folder.name },
            }),
          });
          if (!response.ok) throw new Error('finalize failed');
          router.push('/dashboard/drive?connected=1');
          router.refresh();
        } catch {
          setError('La connexion Drive n’a pas pu être enregistrée. Réessayez.');
          setSaving(false);
        }
      })
      .build();

    picker.setVisible(true);
  }

  return (
    <div className="mt-6">
      <Script
        src={GOOGLE_PICKER_SRC}
        onLoad={() => (window as any).gapi.load('picker', () => setPickerReady(true))}
      />

      {error && (
        <p
          role="alert"
          className="mb-4 max-w-md rounded-lg border border-peach-deep/30 bg-peach/20 px-3 py-2 text-sm text-peach-deep"
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={openPicker}
        disabled={!accessToken || !pickerReady || saving}
        className="rounded-lg border border-line px-4 py-2.5 text-sm hover:border-ink/30 disabled:opacity-50"
      >
        {saving ? 'Enregistrement…' : 'Choisir le dossier racine'}
      </button>
    </div>
  );
}
