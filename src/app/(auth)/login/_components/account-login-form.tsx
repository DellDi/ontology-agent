'use client';

import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';

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
      <div className="space-y-1.5">
        <Label htmlFor="login-account">账号</Label>
        <Input
          autoComplete="username"
          defaultValue={prefillAccount}
          disabled={pending}
          id="login-account"
          maxLength={100}
          name="account"
          placeholder="登录账号"
          required
          type="text"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password">密码</Label>
        <Input
          autoComplete="current-password"
          disabled={pending}
          id="login-password"
          maxLength={1024}
          name="password"
          placeholder="登录密码"
          required
          type="password"
        />
      </div>

      <Button className="mt-2 w-full" disabled={pending} type="submit">
        {pending ? <Spinner aria-hidden="true" /> : null}
        {pending ? '正在登录' : '登录'}
      </Button>
    </>
  );
}
