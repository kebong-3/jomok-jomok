/** Each server request fits a 300-second function; a multi-batch drafting task has no total timer. */
export const AI_REQUEST_BUDGET_MS = 270_000;
export const AI_CLIENT_TIMEOUT_MS = 310_000;

export interface AiProgressEvent {
  phase: 'preparing' | 'requesting' | 'repairing' | 'validating' | 'waiting';
  modelLabel?: string;
  attempt?: number;
}
