import 'server-only';

import { unstable_rethrow } from 'next/navigation';
import { cache } from 'react';

import type { RuntimeEnvironmentView } from '@/application/runtime-environment/presentation';
import { readJavaBackend } from './read-client';
import { runtimeEnvironmentSchema } from './runtime-environment-schema';

/**
 * 环境标识只是辅助信息，读取失败不能拖垮页面：返回 null，由界面显示“环境未知”告警并记录日志。
 * 同一请求内（布局与 metadata）只读取一次。
 */
export const getRuntimeEnvironment = cache(async (): Promise<RuntimeEnvironmentView | null> => {
  try {
    return await readJavaBackend('/api/runtime/environment', runtimeEnvironmentSchema);
  } catch (error) {
    // Next 用异常通知“该路由需要动态渲染”等流程信号，必须原样抛出，不能当作读取失败吞掉。
    unstable_rethrow(error);
    console.error('runtime_environment_unavailable', error);
    return null;
  }
});
