import type { ReactNode } from 'react';
import { Button as ShadcnButton, type ButtonProps as ShadcnButtonProps } from '@/components/ui/button';
import { cn } from '@/app/_lib/cn';

type ButtonVariant = 'primary' | 'secondary';

type ButtonProps = Omit<ShadcnButtonProps, 'variant'> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variantMap: Record<ButtonVariant, ShadcnButtonProps['variant']> = {
  primary: 'default',
  secondary: 'outline',
};

export function Button({ variant = 'primary', className, children, ...props }: ButtonProps) {
  return (
    <ShadcnButton
      variant={variantMap[variant]}
      className={cn(
        variant === 'primary' && 'min-h-[44px] px-4 py-3 text-base font-semibold',
        variant === 'secondary' && 'min-h-[44px] px-4 py-3 text-base font-semibold',
        className,
      )}
      {...props}
    >
      {children}
    </ShadcnButton>
  );
}
