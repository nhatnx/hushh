import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: "Hushh - Understand baby's cry with AI",
  description: "Understand your baby's cries with on-device AI. No audio ever leaves your phone.",
  applicationName: 'Hushh',
  keywords: ['baby cry analyzer', 'baby cry meaning', 'infant cry classification', 'on-device AI', 'PWA'],
  robots: { index: true, follow: true },
  // manifest is intentionally NOT set here — Next.js 15 injects metadata via async RSC streaming,
  // so the <link rel="manifest"> would only appear after JS runs. Chrome requires it in the
  // initial HTML to detect PWA installability. It is added directly in <head> below instead.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Hushh',
  },
  formatDetection: { telephone: false },
  openGraph: {
    title: 'Hushh',
    siteName: 'Hushh',
    description: 'On-device baby cry analysis — 100% private, no cloud required.',
    type: 'website',
    images: ['/icons/icon-512.png'],
  },
  twitter: {
    card: 'summary',
    title: 'Hushh',
    description: 'On-device baby cry analysis — 100% private, no cloud required.',
    images: ['/icons/icon-512.png'],
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
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* manifest must be static in <head> — not via metadata export — so Chrome
            detects it during initial HTML parse for PWA installability checks */}
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        {/* Apply saved theme before first paint to prevent flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t='system';try{t=localStorage.getItem('hushh-theme')||'system'}catch(e){}document.documentElement.dataset.theme=t;})();`,
          }}
        />
        {/* Capture beforeinstallprompt before React loads — the event fires early
            and would be missed if we only listened in useEffect. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__hushhInstallEvent=e;});`,
          }}
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
