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

export function ShellMenu({ items, horizontal = false }: { items: ShellMenuItem[]; horizontal?: boolean }) {
  const pathname = usePathname();
  const activeItem = items.filter(item => isActive(item, pathname)).sort((a, b) => b.href.length - a.href.length)[0];

  return (
    <nav aria-label="主导航" className={horizontal ? "flex flex-wrap gap-1" : "flex flex-wrap gap-1 lg:flex-col"}>
      {items.map((item) => {
        const active = item === activeItem;
        return (
          <Link
            key={item.href + item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`rounded-lg px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              active
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
