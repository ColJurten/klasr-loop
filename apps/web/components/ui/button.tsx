import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'validate' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  // Accent fort : noir profond
  primary: 'bg-ink text-paper hover:bg-ink/85',
  // Sauge = validation, la seule action qui exécute
  validate: 'bg-sage text-ink hover:bg-sage-deep hover:text-paper',
  secondary: 'border border-line bg-transparent text-ink hover:border-ink/30',
  ghost: 'text-ink/60 hover:text-ink',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        'rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}
