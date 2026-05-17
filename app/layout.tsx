import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Hushh - Understand baby's cry with AI",
  description: "Understand your baby's cries with on-device AI. No audio ever leaves your phone.",
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Hushh',
  },
  openGraph: {
    title: 'Hushh',
    description: 'On-device baby cry analysis — 100% private, no cloud required.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#d4785a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        {/* Apply saved theme before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){document.documentElement.dataset.theme=localStorage.getItem('hushh-theme')||'system';})();`,
          }}
        />
        <link
          rel="preload"
          as="script"
          href="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js"
          integrity="sha384-R4iglwC8w7UAyfRq7VUmXEPjrvYnoXIqhsbTUN07o6o8yKYeiTY0/Z6DzbsKgWZ3"
          crossOrigin="anonymous"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
