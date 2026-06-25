import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot, Slottable } from '@radix-ui/react-slot';

import { cn } from '@/app/_lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary !text-primary-foreground hover:bg-primary/90',
        secondary:
          'border border-input bg-card text-foreground hover:bg-secondary',
        ghost: 'text-foreground hover:bg-secondary',
        danger:
          'bg-destructive !text-destructive-foreground hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'min-h-[44px] px-4 py-2.5 text-sm',
        lg: 'min-h-[48px] px-5 py-3 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export type WorkbenchButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** loading=true 时显示内置 spinner 并自动 disabled */
    loading?: boolean;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    /** 用 Radix Slot 渲染子节点（例如换成 a 标签） */
    asChild?: boolean;
  };

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    />
  );
}

export const Button = forwardRef<HTMLButtonElement, WorkbenchButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      loading,
      leftIcon,
      rightIcon,
      disabled,
      children,
      asChild,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot : 'button';
    const isDisabled = disabled || loading;
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={isDisabled}
        aria-busy={loading || undefined}
        data-loading={loading || undefined}
        {...props}
      >
        {loading ? <Spinner /> : leftIcon}
        <Slottable>{children}</Slottable>
        {!loading && rightIcon ? rightIcon : null}
      </Comp>
    );
  },
);

export { buttonVariants };
