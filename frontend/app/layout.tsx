import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nexhacks - Patient Consultation',
  description: 'AI-powered medical consultation platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
