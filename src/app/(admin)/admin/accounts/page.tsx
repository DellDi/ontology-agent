import { redirect } from 'next/navigation';
import { JavaBackendHttpError, readJavaBackend } from '@/infrastructure/java-backend/read-client';
import { identityAccountListSchema } from '@/infrastructure/java-backend/identity-schema';
import { AdminPageHeader } from '../../_components/admin-shell';
import { AccountPasswords } from './account-passwords';

export default async function AccountsPage() {
  let accounts;
  try {
    accounts = await readJavaBackend('/api/admin/identity/accounts', identityAccountListSchema);
  } catch (error) {
    if (error instanceof JavaBackendHttpError) {
      if (error.status === 401) redirect('/login?next=%2Fadmin%2Faccounts');
      if (error.status === 403) return <p role="alert">只有管理员可以维护登录账号。</p>;
    }
    throw error;
  }
  return (
    <section className="space-y-6">
      <AdminPageHeader eyebrow="账号管理" title="登录账号" description="维护本工作台登录账号的密码。" />
      <AccountPasswords accounts={accounts.items} />
    </section>
  );
}
