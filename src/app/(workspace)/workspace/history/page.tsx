import { redirect } from 'next/navigation';

import { latestExecutionSnapshot, sessionToHistoryItem } from '@/application/workspace/home';
import { getWorkspaceHome, JavaBackendHttpError } from '@/infrastructure/java-backend';
import { WorkspaceSessionList } from '../../_components/workspace-session-list';

export default async function WorkspaceHistoryPage() {
  let home;
  try {
    home = await getWorkspaceHome();
  } catch (error) {
    if (error instanceof JavaBackendHttpError && error.status === 401) {
      redirect('/login?next=/workspace/history');
    }
    throw error;
  }

  return (
    <div className="mx-auto w-full max-w-4xl py-6">
      <h1 className="mb-7 text-2xl font-medium tracking-tight">分析记录</h1>
      <WorkspaceSessionList
        items={home.sessions.map(session => sessionToHistoryItem(session, latestExecutionSnapshot(session.latestExecution)))}
        sessionPage={home.sessionPage}
        canCreateAnalysis={home.capabilities.some(capability => capability.available)}
      />
    </div>
  );
}
