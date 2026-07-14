import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'klasr — le classement, en un clic',
  description:
    "Klasr analyse vos documents Drive, propose un nom et un dossier de destination. Confirmez. Klasr s'occupe du reste.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-paper font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
