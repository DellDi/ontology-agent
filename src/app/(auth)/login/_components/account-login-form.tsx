'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/app/_components/workbench/button';
import { Field, FieldInput, FieldLabel } from '@/app/_components/workbench/field';

type AccountLoginFormProps = {
  nextPath: string;
  prefillAccount?: string;
};

export function AccountLoginForm({
  nextPath,
  prefillAccount,
}: AccountLoginFormProps) {
  return (
    <form action="/api/auth/login" method="post" className="mt-5 space-y-4">
      <input type="hidden" name="next" value={nextPath} />
      <AccountLoginControls prefillAccount={prefillAccount} />
    </form>
  );
}

function AccountLoginControls({
  prefillAccount,
}: {
  prefillAccount?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <Field required disabled={pending}>
        <FieldLabel>账号</FieldLabel>
        <FieldInput
          type="text"
          name="account"
          placeholder="登录账号"
          defaultValue={prefillAccount}
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
          placeholder="登录密码"
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
