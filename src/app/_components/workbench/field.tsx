'use client';

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

import { cn } from '@/app/_lib/cn';

type FieldContextValue = {
  id: string;
  errorId: string;
  helperId: string;
  hasError: boolean;
  required?: boolean;
  disabled?: boolean;
};

const FieldContext = createContext<FieldContextValue | null>(null);

function useFieldContext() {
  return useContext(FieldContext);
}

type FieldProps = HTMLAttributes<HTMLDivElement> & {
  id?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string | null;
  children: ReactNode;
};

/**
 * 字段容器。为 Label / Input / Textarea / Helper / Error 注入共享 id 与 aria 关系。
 */
export function Field({
  id,
  required,
  disabled,
  error,
  children,
  className,
  ...props
}: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? `field-${autoId}`;
  const value: FieldContextValue = {
    id: fieldId,
    errorId: `${fieldId}-error`,
    helperId: `${fieldId}-helper`,
    hasError: Boolean(error),
    required,
    disabled,
  };
  return (
    <FieldContext.Provider value={value}>
      <div className={cn('space-y-1.5', className)} {...props}>
        {children}
        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </FieldContext.Provider>
  );
}

type FieldLabelProps = LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode;
};

export function FieldLabel({ className, children, ...props }: FieldLabelProps) {
  const ctx = useFieldContext();
  return (
    <label
      htmlFor={ctx?.id}
      className={cn(
        'block text-sm font-semibold text-foreground',
        ctx?.disabled && 'opacity-60',
        className,
      )}
      {...props}
    >
      {children}
      {ctx?.required ? (
        <span aria-hidden className="ml-1 text-[color:var(--danger-500)]">
          *
        </span>
      ) : null}
    </label>
  );
}

const fieldControlStyles =
  'w-full rounded-md border border-input bg-card px-3.5 py-2.5 text-sm text-foreground placeholder:text-[color:var(--ink-500)] transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60';

export type FieldInputProps = InputHTMLAttributes<HTMLInputElement>;

export const FieldInput = forwardRef<HTMLInputElement, FieldInputProps>(
  function FieldInput({ className, ...props }, ref) {
    const ctx = useFieldContext();
    return (
      <input
        ref={ref}
        id={ctx?.id}
        aria-invalid={ctx?.hasError || undefined}
        aria-describedby={ctx?.hasError ? ctx.errorId : undefined}
        aria-required={ctx?.required || undefined}
        disabled={ctx?.disabled}
        className={cn(fieldControlStyles, 'h-11', className)}
        {...props}
      />
    );
  },
);

export type FieldTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const FieldTextarea = forwardRef<HTMLTextAreaElement, FieldTextareaProps>(
  function FieldTextarea({ className, ...props }, ref) {
    const ctx = useFieldContext();
    return (
      <textarea
        ref={ref}
        id={ctx?.id}
        aria-invalid={ctx?.hasError || undefined}
        aria-describedby={ctx?.hasError ? ctx.errorId : undefined}
        aria-required={ctx?.required || undefined}
        disabled={ctx?.disabled}
        className={cn(
          fieldControlStyles,
          'min-h-[6rem] resize-y leading-7',
          className,
        )}
        {...props}
      />
    );
  },
);

type FieldHelperProps = HTMLAttributes<HTMLParagraphElement> & {
  children: ReactNode;
};

export function FieldHelper({ className, children, ...props }: FieldHelperProps) {
  const ctx = useFieldContext();
  return (
    <p
      id={ctx?.helperId}
      className={cn('text-xs leading-5 text-muted-foreground', className)}
      {...props}
    >
      {children}
    </p>
  );
}

type FieldErrorProps = HTMLAttributes<HTMLParagraphElement> & {
  children: ReactNode;
};

export function FieldError({ className, children, ...props }: FieldErrorProps) {
  const ctx = useFieldContext();
  return (
    <p
      id={ctx?.errorId}
      role="alert"
      className={cn(
        'text-xs font-medium text-[color:var(--danger-500)]',
        className,
      )}
      {...props}
    >
      {children}
    </p>
  );
}
