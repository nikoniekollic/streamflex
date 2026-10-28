import { Link, Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { safeRedirect, validateRedirectSearch } from '@/lib/auth'

export const Route = createFileRoute('/_guest')({
  validateSearch: validateRedirectSearch,
  beforeLoad: ({ context, search }) => {
    if (context.session) throw redirect({ href: safeRedirect(search.redirect), replace: true })
  },
  component: GuestLayout,
})

function GuestLayout() {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-black px-4 py-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(229,9,20,0.25),transparent_60%),radial-gradient(ellipse_at_bottom_right,rgba(120,0,0,0.35),transparent_55%)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/30" />
      <Link to="/login" className="absolute top-5 left-6 z-20 text-2xl font-extrabold tracking-tight text-primary md:left-12 md:text-3xl">
        STREAMFLEX
      </Link>
      <div className="relative z-10 w-full max-w-md">
        <Outlet />
      </div>
    </main>
  )
}
