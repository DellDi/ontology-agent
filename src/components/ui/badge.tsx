import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        neutral:
          "border-border bg-card text-muted-foreground",
        info:
          "border-[color:var(--brand-300)]/40 bg-[color:color-mix(in_srgb,var(--brand-500)_10%,transparent)] text-[color:var(--brand-700)]",
        success:
          "border-[color:var(--success-500)]/40 bg-[color:color-mix(in_srgb,var(--success-500)_12%,transparent)] text-[color:color-mix(in_srgb,var(--success-500)_70%,var(--ink-900))]",
        warning:
          "border-[color:var(--warning-500)]/40 bg-[color:color-mix(in_srgb,var(--warning-500)_14%,transparent)] text-[color:color-mix(in_srgb,var(--warning-500)_70%,var(--ink-900))]",
        error:
          "border-[color:var(--danger-500)]/40 bg-[color:color-mix(in_srgb,var(--danger-500)_10%,transparent)] text-[color:color-mix(in_srgb,var(--danger-500)_70%,var(--ink-900))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
