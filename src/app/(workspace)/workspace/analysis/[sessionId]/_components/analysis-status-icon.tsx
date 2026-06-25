'use client';

import type { ConversationAssistantStatus } from '@/application/analysis-message-projection/conversation-view-model';
import type { ReactNode } from 'react';

export function getStatusIcon(status: ConversationAssistantStatus): ReactNode {
  switch (status) {
    case 'running':
      return (
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-40" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
        </span>
      );
    case 'completed':
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
      );
    case 'failed':
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-rose-400" />
      );
    case 'disconnected':
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400" />
      );
    case 'queued':
    default:
      return (
        <span className="flex h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
      );
  }
}