import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MedLab | Laboratory workspace',
  description: 'Secure laboratory operations and clinical results workspace.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
