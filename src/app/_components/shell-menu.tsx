'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { ShellMenuItem } from './shell-menu-config';

function isActive(item: ShellMenuItem, current: string): boolean {
  if (current === item.href) return true;
  if (current.startsWith(item.activePrefix + '/')) return true;
  if (current.startsWith(item.activePrefix) && item.activePrefix.length > 1) {
    const remaining = current.slice(item.activePrefix.length);
    if (remaining === '' || remaining.startsWith('/')) return true;
  }
  return false;
}

export function ShellMenu({ items }: { items: ShellMenuItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
            className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${
              active
                ? 'bg-[color:var(--brand-100)] text-[color:var(--brand-800)]'
                : 'text-[color:var(--ink-600)] hover:bg-white/70 hover:text-[color:var(--ink-900)]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
