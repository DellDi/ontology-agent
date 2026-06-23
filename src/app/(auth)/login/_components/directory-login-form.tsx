'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/app/_components/workbench/button';
import { Field, FieldInput, FieldLabel } from '@/app/_components/workbench/field';

type DirectoryLoginFormProps = {
  nextPath: string;
  prefillAccount?: string;
};

export function DirectoryLoginForm({
  nextPath,
  prefillAccount,
}: DirectoryLoginFormProps) {
  return (
    <form
      action="/api/auth/directory-login"
      method="post"
      className="mt-5 space-y-4"
    >
      <input type="hidden" name="next" value={nextPath} />
      <DirectoryLoginControls prefillAccount={prefillAccount} />
    </form>
  );
}

function DirectoryLoginControls({
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
          placeholder="ERP 登录账号"
          defaultValue={prefillAccount}
          autoComplete="username"
          required
        />
      </Field>

      <Field required disabled={pending}>
        <FieldLabel>密码</FieldLabel>
        <FieldInput
          type="password"
          name="password"
          placeholder="ERP 登录密码"
          autoComplete="current-password"
          required
        />
      </Field>

      <Button className="mt-2 w-full" type="submit" loading={pending}>
        {pending ? '正在进入 DIP3 工作台' : '进入 DIP3 工作台'}
      </Button>

      {pending ? (
        <p
          className="text-center text-xs leading-5 text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          正在校验账号并加载你的工作台数据，请稍候。
        </p>
      ) : null}
    </>
  );
}
