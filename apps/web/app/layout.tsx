import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Top Sales',
  description: 'AI-powered Sales, Booking & CRM System',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-HK">
      <body>{children}</body>
    </html>
  );
}
