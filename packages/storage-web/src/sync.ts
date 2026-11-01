import { acknowledgeOperations, pendingOperations } from './index';

export type SyncOutcome =
  | { status: 'empty'; acknowledged: 0 }
  | { status: 'offline'; acknowledged: 0 }
  | { status: 'authentication_required'; acknowledged: 0 }
  | { status: 'email_verification_required'; acknowledged: 0 }
  | { status: 'service_unavailable'; acknowledged: 0 }
  | { status: 'invalid_response'; acknowledged: 0 }
  | { status: 'network_error'; acknowledged: 0 }
  | { status: 'synced'; acknowledged: number };

type SyncResponse = { accepted?: unknown; duplicates?: unknown };

export async function syncPendingOperations(apiBase = '/api'): Promise<SyncOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { status: 'offline', acknowledged: 0 };
  }

  const operations = await pendingOperations(100);
  if (operations.length === 0) return { status: 'empty', acknowledged: 0 };

  try {
    const response = await fetch(apiBase.replace(/\/$/, '') + '/v1/sync/push', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ operations })
    });

    if (response.status === 401) return { status: 'authentication_required', acknowledged: 0 };
    if (response.status === 403) return { status: 'email_verification_required', acknowledged: 0 };
    if (response.status === 503 || !response.ok) return { status: 'service_unavailable', acknowledged: 0 };

    const payload = await response.json() as SyncResponse;
    if (!Array.isArray(payload.accepted) || !Array.isArray(payload.duplicates)) {
      return { status: 'invalid_response', acknowledged: 0 };
    }

    const submitted = new Set(operations.map((operation) => operation.operationId));
    const confirmed = new Set([...payload.accepted, ...payload.duplicates]);
    for (const operationId of confirmed) {
      if (typeof operationId !== 'string' || !submitted.has(operationId)) {
        return { status: 'invalid_response', acknowledged: 0 };
      }
    }

    const acknowledgedIds = [...confirmed] as string[];
    if (acknowledgedIds.length > 0) await acknowledgeOperations(acknowledgedIds);
    return { status: 'synced', acknowledged: acknowledgedIds.length };
  } catch {
    return { status: 'network_error', acknowledged: 0 };
  }
}
