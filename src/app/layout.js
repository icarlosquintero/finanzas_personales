import './globals.css'
import AuthProvider from '@/components/AuthProvider'

export const metadata = {
  title: 'Finanzas Personales',
  description: 'Control de gastos y finanzas personales',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Finanzas',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',      // ← enables env(safe-area-inset-*) on iPhone
  themeColor: '#F5F5F7',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" data-theme="light">
      <body style={{ fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
