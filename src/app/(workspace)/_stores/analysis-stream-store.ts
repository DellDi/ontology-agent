import { create } from 'zustand';

type AnalysisStreamState = {
  connectionStatus: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'timed_out';
  lastEventAt: string | null;
  reconnectCount: number;
  setConnectionStatus: (status: AnalysisStreamState['connectionStatus']) => void;
  setLastEventAt: (at: string) => void;
  incrementReconnect: () => void;
  reset: () => void;
};

export const useAnalysisStreamStore = create<AnalysisStreamState>((set) => ({
  connectionStatus: 'idle',
  lastEventAt: null,
  reconnectCount: 0,
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setLastEventAt: (lastEventAt) => set({ lastEventAt }),
  incrementReconnect: () => set((state) => ({ reconnectCount: state.reconnectCount + 1 })),
  reset: () => set({ connectionStatus: 'idle', lastEventAt: null, reconnectCount: 0 }),
}));