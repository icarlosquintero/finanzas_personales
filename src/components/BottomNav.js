'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function BottomNav() {
  const pathname = usePathname()
  const navItems = [
    { name: 'Resumen', path: '/', icon: '📊' },
    { name: 'Gastos', path: '/gastos', icon: '💳' },
    { name: 'Planes', path: '/presupuestos', icon: '📋' },
    { name: 'Deudas', path: '/deudas', icon: '📝' },
    { name: 'Cuentas', path: '/cuentas', icon: '🏦' },
    { name: 'Config', path: '/config', icon: '⚙️' },
  ]

  return (
    <nav className="bottom-nav" aria-label="Navegación principal">
      {navItems.map((item) => {
        const isActive = pathname === item.path
        return (
          <Link 
            key={item.name} 
            href={item.path}
            aria-current={isActive ? 'page' : undefined}
            className={`bottom-nav-item ${isActive ? 'bottom-nav-item-active' : ''}`}
          >
            <span className="nav-icon" style={{ fontSize: '20px' }}>{item.icon}</span>
            <span>{item.name}</span>
          </Link>
        )
      })}

    </nav>
  )
}
