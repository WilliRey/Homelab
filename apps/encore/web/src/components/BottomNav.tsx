import { NavLink } from 'react-router-dom';
import { HomeIcon, LibraryIcon, SearchIcon, SettingsIcon } from './Icons';

const items = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/library', label: 'Library', Icon: LibraryIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

export function BottomNav() {
  return (
    <nav className="flex border-t border-line bg-surface/95 backdrop-blur" aria-label="Main">
      {items.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) => `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`}
        >
          <Icon size={22} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
