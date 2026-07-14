/**
 * Logo klasr : une barre verticale noire et des barres horizontales rangées à
 * sa droite — les deux premières en lavande — évoquant un classeur qui range
 * des documents. Toujours accompagné du mot-symbole en minuscules.
 */
export function KlasrMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="2" y="2" width="3.5" height="18" rx="1" fill="#0A0A0A" />
      <rect x="8" y="2" width="12" height="3" rx="1" fill="#AFA9EC" />
      <rect x="8" y="7" width="9" height="3" rx="1" fill="#AFA9EC" />
      <rect x="8" y="12" width="12" height="3" rx="1" fill="#0A0A0A" />
      <rect x="8" y="17" width="7" height="3" rx="1" fill="#0A0A0A" />
    </svg>
  );
}

export function KlasrLogo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <KlasrMark size={size} />
      <span className="text-lg font-medium lowercase tracking-tight">klasr</span>
    </span>
  );
}
