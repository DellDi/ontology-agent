import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/app/_lib/cn';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
  children: ReactNode;
};

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        variant === 'primary' && 'primary-button',
        variant === 'secondary' && 'secondary-button',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}