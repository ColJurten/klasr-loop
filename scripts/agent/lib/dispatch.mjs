/**
 * repository_dispatch payloads carry IDENTIFIERS ONLY. The worker fetches
 * authoritative issue/PR/comment/diff/check data from GitHub — never trusts
 * a copied body, never receives secret-bearing context through the payload.
 */
import { DISPATCH_TYPES } from './normalize.mjs';

export function buildDispatchPayload(decision) {
  if (decision.action !== 'dispatch') {
    throw new Error(`cannot build dispatch for decision: ${decision.action}`);
  }
  if (!DISPATCH_TYPES.includes(decision.dispatchType)) {
    throw new Error(`unknown dispatch type: ${decision.dispatchType}`);
  }
  const refs = decision.refs ?? {};
  for (const [field, value] of Object.entries(refs)) {
    const isScalar = ['string', 'number', 'boolean'].includes(typeof value) || value === null;
    const isCommand = field === 'command' && typeof value === 'object';
    if (!isScalar && !isCommand) {
      throw new Error(`dispatch payload field ${field} must be a scalar identifier`);
    }
  }
  return {
    event_type: decision.dispatchType,
    client_payload: {
      version: 1,
      event_key: decision.key,
      task: decision.task ?? null,
      actor: decision.actor ?? null,
      ...refs,
    },
  };
}
