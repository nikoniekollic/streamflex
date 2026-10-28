import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDown, LogOut, MessageSquarePlus, Pencil, ShieldCheck, UserCog } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProfileAvatar } from '@/components/profile/ProfileAvatar'
import { useActiveProfile } from '@/components/profile/ActiveProfileContext'
import { useSignOut } from '@/lib/profile'

export function ProfileMenu({ isAdmin }: { isAdmin: boolean }) {
  const { profiles, activeProfile, isKids, selectProfile } = useActiveProfile()
  const navigate = useNavigate()
  const signOut = useSignOut()
  if (!activeProfile) return null
  const others = profiles.filter((p) => p.id !== activeProfile.id)

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Profil : ${activeProfile.name}`}
          className="group flex items-center gap-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <ProfileAvatar name={activeProfile.name} avatarUrl={activeProfile.avatar_url} className="size-8" textClassName="text-sm" />
          <ChevronDown className="size-4 text-neutral-300 transition group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 border-white/10 bg-black/95 text-white">
        <DropdownMenuLabel className="truncate text-neutral-400">{activeProfile.name}{isKids && ' · Enfants'}</DropdownMenuLabel>
        {others.map((p) => (
          <DropdownMenuItem
            key={p.id}
            className="focus:bg-white/10 focus:text-white"
            onSelect={() => (p.has_pin ? void navigate({ to: '/profiles' }) : void selectProfile(p.id, window.location.pathname))}
          >
            <ProfileAvatar name={p.name} avatarUrl={p.avatar_url} className="size-7" textClassName="text-xs" locked={p.has_pin} />
            <span className="truncate">{p.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem asChild className="focus:bg-white/10 focus:text-white">
          <Link to="/profiles">
            <Pencil /> Gérer les profils
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="focus:bg-white/10 focus:text-white">
          <Link to="/request">
            <MessageSquarePlus /> Demander un titre
          </Link>
        </DropdownMenuItem>
        {!isKids && (
          <>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem asChild className="focus:bg-white/10 focus:text-white">
              <Link to="/profile">
                <UserCog /> Compte & abonnement
              </Link>
            </DropdownMenuItem>
            {isAdmin && (
              <DropdownMenuItem asChild className="focus:bg-white/10 focus:text-white">
                <Link to="/admin">
                  <ShieldCheck /> Administration
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem className="focus:bg-white/10 focus:text-white" onSelect={() => void signOut()}>
          <LogOut /> Déconnexion
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
