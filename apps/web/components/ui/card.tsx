import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

/** Charte : bordures fines, coins 8–12 px, aucune ombre. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('rounded-xl border border-line bg-white p-4', className)}
      {...props}
    />
  );
}
