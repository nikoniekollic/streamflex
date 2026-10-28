import { useEffect, useState } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { Baby, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ProfileMenu } from '@/components/layout/ProfileMenu'
import { HeaderSearch } from '@/components/layout/HeaderSearch'
import { NotificationBell } from '@/components/layout/NotificationBell'

export function AppHeader() {
  const { isAdmin, isKids } = useRouteContext({ from: '/_authed' })
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 flex h-16 items-center gap-6 px-6 transition-colors duration-300 md:px-12',
        scrolled ? 'bg-background' : 'bg-gradient-to-b from-black/90 to-transparent',
      )}
    >
      <Link to="/" className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-primary md:text-3xl">
        STREAMFLEX
        {isKids && (
          <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2 py-0.5 text-xs font-bold tracking-normal text-black">
            <Baby className="size-3.5" /> Enfants
          </span>
        )}
      </Link>
      <nav className="hidden gap-4 text-sm text-neutral-300 md:flex">
        <Link to="/" activeOptions={{ exact: true }} activeProps={{ className: 'font-semibold text-white' }}>
          Accueil
        </Link>
        <Link to="/browse" activeProps={{ className: 'font-semibold text-white' }}>
          Catalogue
        </Link>
        <Link to="/my-list" activeProps={{ className: 'font-semibold text-white' }}>
          Ma liste
        </Link>
        <Link to="/history" activeProps={{ className: 'font-semibold text-white' }}>
          Historique
        </Link>
        {isAdmin && !isKids && (
          <Link to="/admin" className="flex items-center gap-1" activeProps={{ className: 'font-semibold text-white' }}>
            <ShieldCheck className="size-4" /> Admin
          </Link>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-3">
        <HeaderSearch />
        <NotificationBell />
        <ProfileMenu isAdmin={isAdmin} />
      </div>
    </header>
  )
}
