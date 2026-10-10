import './globals.css';
import type { Metadata, Viewport } from 'next';
import { AppProvider } from '../lib/client/AppContext';

export const metadata: Metadata = {
  title: 'Agri Mall — The Global Plant Marketplace',
  description:
    'Buy plants from verified nurseries across India. Order from several nurseries in one basket, each parcel tracked separately.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#1C3829',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
      </head>
      <body>
        <AppProvider>
          {/* Mount points the existing components draw into. */}
          <canvas id="cfv" />
          <div id="ptcl" />
          <div id="toast-wrap" className="toast-wrap" />
          {children}
        </AppProvider>
      </body>
    </html>
  );
}
