import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const inter = localFont({
  src: [
    { path: './fonts/Inter-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Inter-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
});

const jetBrainsMono = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/JetBrainsMono-Medium.woff2', weight: '500', style: 'normal' },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'klasr — le classement, en un clic',
  description:
    "Klasr analyse vos documents Drive, propose un nom et un dossier de destination. Confirmez. Klasr s'occupe du reste.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body
        className={`${inter.variable} ${jetBrainsMono.variable} min-h-screen bg-paper font-sans text-ink antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
