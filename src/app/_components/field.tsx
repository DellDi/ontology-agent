import type { LabelHTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Textarea as ShadcnTextarea } from '@/components/ui/textarea';
import { cn } from '@/app/_lib/cn';

type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
};

export function FieldLabel({ className, children, ...props }: FieldLabelProps) {
  return (
    <label
      className={cn(
        'text-sm font-medium leading-none text-foreground',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}

type FieldInputProps = InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
};

export function FieldInput({ className, ...props }: FieldInputProps) {
  return (
    <ShadcnInput
      className={cn('h-11 px-3.5 text-base', className)}
      {...props}
    />
  );
}

type FieldTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  className?: string;
};

export function FieldTextarea({ className, ...props }: FieldTextareaProps) {
  return (
    <ShadcnTextarea
      className={cn('text-base', className)}
      {...props}
    />
  );
}
