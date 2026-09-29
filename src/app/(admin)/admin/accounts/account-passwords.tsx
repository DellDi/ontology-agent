'use client';

import { useRef, useState, type FormEvent } from 'react';
import { identityAccountSchema, type IdentityAccount } from '@/infrastructure/java-backend/identity-schema';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function AccountPasswords({ accounts }: { accounts: IdentityAccount[] }) {
  const [selected, setSelected] = useState<IdentityAccount | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function select(account: IdentityAccount | null) {
    setSelected(account);
    setPassword('');
    setConfirmation('');
    setError('');
    setSuccess('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending.current) return;
    setError('');
    setSuccess('');
    if (password !== confirmation) {
      setError('两次输入的密码不一致。');
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/identity/accounts/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string'
          ? `${payload.error}${payload.traceId ? `（追踪号：${payload.traceId}）` : ''}`
          : `修改失败（HTTP ${response.status}）。`);
      }
      const updated = identityAccountSchema.parse(payload);
      setSuccess(`账号 ${updated.account} 的密码已修改，下次登录请使用新密码。已登录的会话仍然有效。`);
      setPassword('');
      setConfirmation('');
      setSelected(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : '修改密码失败。');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {success && <p role="status" className="text-sm text-foreground">{success}</p>}
      <ul className="divide-y divide-border rounded-md border border-border bg-card px-5">
        {accounts.map((account) => (
          <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="min-w-0">
              <p className="break-all font-medium">{account.account}</p>
              <p className="text-sm text-muted-foreground">
                {account.displayName} · {account.roles.includes('PLATFORM_ADMIN') ? '管理员' : '普通用户'}
                {' · '}{account.status === 'active' ? '已启用' : '已停用'}
              </p>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => select(account)}>修改密码</Button>
          </li>
        ))}
      </ul>
      {accounts.length === 0 && <p className="text-sm text-muted-foreground">暂无登录账号。</p>}
      {selected && (
        <form onSubmit={submit} className="max-w-lg space-y-4 rounded-md border border-border bg-card p-5" aria-label={`修改 ${selected.account} 的密码`}>
          <h3 className="font-semibold">修改 {selected.account} 的密码</h3>
          <p className="text-sm text-muted-foreground">密码长度为 8–1024 个字符。修改后，已经登录的会话仍然有效。</p>
          <label className="grid gap-2 text-sm">
            新密码
            <Input type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          </label>
          <label className="grid gap-2 text-sm">
            确认新密码
            <Input type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
          </label>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-3">
            <Button type="submit" disabled={busy}>{busy ? '保存中…' : '保存新密码'}</Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => select(null)}>取消</Button>
          </div>
        </form>
      )}
    </div>
  );
}
