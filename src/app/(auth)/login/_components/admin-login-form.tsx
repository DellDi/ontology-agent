'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/app/_components/workbench/button';
import { Field, FieldInput, FieldLabel } from '@/app/_components/workbench/field';

export function AdminLoginForm() {
  return (
    <form
      action="/api/auth/admin-login"
      method="post"
      className="mt-4 space-y-4"
    >
      <AdminLoginControls />
    </form>
  );
}

function AdminLoginControls() {
  const { pending } = useFormStatus();

  return (
    <>
      <Field required disabled={pending}>
        <FieldLabel>管理员账号</FieldLabel>
        <FieldInput
          type="text"
          name="account"
          autoComplete="username"
          required
          maxLength={100}
        />
      </Field>

      <Field required disabled={pending}>
        <FieldLabel>密码</FieldLabel>
        <FieldInput
          type="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={1024}
        />
      </Field>

      <Button className="mt-2 w-full" type="submit" loading={pending}>
        {pending ? '正在登录' : '登录'}
      </Button>
    </>
  );
}
