import { create } from 'zustand';

type WorkspaceState = {
  selectedProjectId: string | null;
  isCreatingSession: boolean;
  creationError: string | null;
  setSelectedProjectId: (id: string | null) => void;
  setCreatingSession: (creating: boolean) => void;
  setCreationError: (error: string | null) => void;
};

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedProjectId: null,
  isCreatingSession: false,
  creationError: null,
  setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),
  setCreatingSession: (isCreatingSession) => set({ isCreatingSession }),
  setCreationError: (creationError) => set({ creationError, isCreatingSession: false }),
}));