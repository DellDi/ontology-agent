import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function stopProcessTree(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    await execFileAsync('taskkill', [
      '/pid',
      String(processHandle.pid),
      '/t',
      '/f',
    ]);
    return;
  }

  if (!processHandle.kill('SIGINT')) {
    throw new Error(`无法停止测试服务进程 ${processHandle.pid}。`);
  }
  await once(processHandle, 'exit');
}
