import './globals.css'
import AuthProvider from '@/components/AuthProvider'

export const metadata = {
  title: 'Finanzas Personales',
  description: 'Control de gastos y finanzas personales',
  manifest: '/manifest.json',
  icons: {
    icon: '/icon.svg',
  },
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
