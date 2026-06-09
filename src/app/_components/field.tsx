import type { LabelHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/app/_lib/cn';

type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
};

export function FieldLabel({ className, children, ...props }: FieldLabelProps) {
  return (
    <label className={cn('field-label', className)} {...props}>
      {children}
    </label>
  );
}

type FieldInputProps = InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export function FieldInput({ className, ...props }: FieldInputProps) {
  return (
    <input className={cn('field-input', className)} {...props} />
  );
}