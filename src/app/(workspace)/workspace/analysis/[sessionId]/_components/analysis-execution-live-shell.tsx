'use client';

import { useEffect, useState } from 'react';

import type { AnalysisExecutionStreamReadModel } from '@/application/analysis-execution/stream-use-cases';
import type { AnalysisExecutionStreamEvent } from '@/domain/analysis-execution/stream-models';
import type { AnalysisConclusionReadModel } from '@/domain/analysis-result/models';
import {
  buildLiveConclusionReadModel,
  mergeExecutionEvents,
} from '../analysis-execution-display';
import { AnalysisConclusionPanel } from './analysis-conclusion-panel';
import { AnalysisExecutionStreamPanel } from './analysis-execution-stream-panel';

type AnalysisExecutionLiveShellProps = {
  sessionId: string;
  executionId: string;
  initialReadModel: AnalysisExecutionStreamReadModel;
  initialConclusionReadModel: AnalysisConclusionReadModel | null;
};

export function AnalysisExecutionLiveShell({
  sessionId,
  executionId,
  initialReadModel,
  initialConclusionReadModel,
}: AnalysisExecutionLiveShellProps) {
  const [events, setEvents] = useState(initialReadModel.events);
  const [conclusionReadModel, setConclusionReadModel] = useState(
    buildLiveConclusionReadModel({
      events: initialReadModel.events,
      fallbackReadModel: initialConclusionReadModel,
    }),
  );

  useEffect(() => {
    setEvents(initialReadModel.events);
    setConclusionReadModel(
      buildLiveConclusionReadModel({
        events: initialReadModel.events,
        fallbackReadModel: initialConclusionReadModel,
      }),
    );
  }, [executionId, initialConclusionReadModel, initialReadModel.events]);

  useEffect(() => {
    const eventSource = new EventSource(
      `/api/analysis/sessions/${sessionId}/stream?executionId=${executionId}`,
    );

    eventSource.onmessage = (message) => {
      const nextEvent = JSON.parse(message.data) as AnalysisExecutionStreamEvent;

      setEvents((previousEvents) => {
        const nextEvents = mergeExecutionEvents(previousEvents, nextEvent);

        setConclusionReadModel((previousConclusionReadModel) =>
          buildLiveConclusionReadModel({
            events: nextEvents,
            fallbackReadModel:
              previousConclusionReadModel ?? initialConclusionReadModel,
          }),
        );

        return nextEvents;
      });

      if (
        nextEvent.kind === 'execution-status' &&
        (nextEvent.status === 'completed' || nextEvent.status === 'failed')
      ) {
        eventSource.close();
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [executionId, initialConclusionReadModel, sessionId]);

  return (
    <>
      {conclusionReadModel ? (
        <AnalysisConclusionPanel readModel={conclusionReadModel} />
      ) : null}
      <AnalysisExecutionStreamPanel events={events} />
    </>
  );
}
