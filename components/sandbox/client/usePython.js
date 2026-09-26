// usePython()（规格 §3.3）：useSyncExternalStore 包装整页单例 pythonClient
// 返回 { status, progress, error, runs, ensure, writeFiles, run, test, http, stop, sendInput, restart }；
// 方法引用稳定（来自单例），快照在状态变化时整体换新
import { useMemo, useSyncExternalStore } from 'react';
import { getPythonClient } from './pythonClient.js';

export function usePython() {
  const client = getPythonClient();
  const snap = useSyncExternalStore(client.subscribe, client.getSnapshot, client.getSnapshot);
  return useMemo(() => ({
    status: snap.status,
    progress: snap.progress,
    error: snap.error,
    runs: snap.runs,
    ensure: client.ensure,
    writeFiles: client.writeFiles,
    run: client.run,
    test: client.test,
    http: client.http,
    stop: client.stop,
    sendInput: client.sendInput,
    restart: client.restart,
  }), [client, snap]);
}

export default usePython;
