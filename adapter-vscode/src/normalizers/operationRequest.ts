import type { OperationRequest } from '../protocol/types.js';
import { inferNormalization, type AdapterOperationInput } from './normalizedEffects.js';

export function normalizeOperationRequest(input: AdapterOperationInput): OperationRequest {
  const normalized = inferNormalization(input);
  const request: OperationRequest = {
    id: input.id,
    source: input.source,
    session: input.session,
    workspace: input.workspace,
    tool: input.tool,
    category: input.category,
    normalized_effects: normalized.normalizedEffects,
    requested_permissions: normalized.requestedPermissions,
    risk_signals: normalized.riskSignals,
    timestamp: input.timestamp,
  };

  if (input.intent !== undefined) {
    request.intent = input.intent;
  }
  if (input.arguments !== undefined) {
    request.arguments = input.arguments;
  }
  if (input.modelContext !== undefined) {
    request.model_context = input.modelContext;
  }

  return request;
}
