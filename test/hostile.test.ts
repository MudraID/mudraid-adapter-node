/**
 * Focused hostile / deny-closed unit tests for the V2 control loop.
 *
 * These sit alongside the corpus-parity suite and pin the security-critical
 * invariants directly (with a spy on the `/decide` seam), independent of the
 * corpus fixture shape.
 */

import { describe, expect, it, vi } from 'vitest';

import { evaluateV2 } from '../src/controlLoop.js';
import { staticDecideClient, throwingDecideClient } from '../src/decideClient.js';
import type { DecideClient, DecideResult, RequestFacts } from '../src/types.js';

const mappedToolCall: RequestFacts = {
  protected: true,
  bundleActive: true,
  method: 'POST',
  jsonShape: 'object',
  jsonrpc: '2.0',
  rpcMethod: 'tools/call',
  toolName: 'issue_refund',
  actionMapped: true,
};

/** A `/decide` seam that fails the test if it is ever invoked. */
function neverCalled(): DecideClient {
  return vi.fn(async (): Promise<DecideResult> => {
    throw new Error('/decide must not be called on this path');
  });
}

describe('reserved-header stripping', () => {
  it('strips spoofed x-mudraid-* headers (mixed case) even on an allow', async () => {
    const decision = await evaluateV2(
      {
        ...mappedToolCall,
        reservedHeadersPresented: [
          'x-mudraid-decision-id',
          'X-MudraID-Bundle-Version',
          'authorization',
        ],
      },
      staticDecideClient({ status: 'allow' }),
    );
    expect(decision.outcome).toBe('allow');
    expect([...decision.strippedReservedHeaders]).toEqual([
      'x-mudraid-decision-id',
      'X-MudraID-Bundle-Version',
    ]);
  });

  it('strips forged trusted-context headers even on a DENY path', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2(
      {
        ...mappedToolCall,
        actionMapped: false, // will deny at action resolution, before /decide
        reservedHeadersPresented: ['x-mudraid-decision-id', 'authorization'],
      },
      decide,
    );
    expect(decision.outcome).toBe('deny');
    expect(decision.adapterCode).toBe('ENFORCE_ACTION_UNMAPPED');
    expect([...decision.strippedReservedHeaders]).toEqual(['x-mudraid-decision-id']);
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('bounded framing rejections', () => {
  it('rejects a JSON-RPC batch (array body) wholesale without calling /decide', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2(
      { protected: true, bundleActive: true, method: 'POST', jsonShape: 'array' },
      decide,
    );
    expect(decision.outcome).toBe('deny');
    expect(decision.adapterCode).toBe('ENFORCE_BATCH_UNSUPPORTED');
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects an oversized body (413) without calling /decide', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2(
      { protected: true, bundleActive: true, method: 'POST', bodyTooLarge: true },
      decide,
    );
    expect(decision.httpStatus).toBe(413);
    expect(decision.adapterCode).toBe('ENFORCE_BODY_TOO_LARGE');
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects a malformed (scalar) body without calling /decide', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2(
      { protected: true, bundleActive: true, method: 'POST', jsonShape: 'scalar' },
      decide,
    );
    expect(decision.adapterCode).toBe('ENFORCE_MALFORMED_REQUEST');
    expect(decide).not.toHaveBeenCalled();
  });

  it('rejects a tool name one byte over the 512-byte bound', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2(
      { ...mappedToolCall, toolName: 'a'.repeat(513) },
      decide,
    );
    expect(decision.adapterCode).toBe('ENFORCE_MALFORMED_REQUEST');
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('deny-closed on decide failure', () => {
  it('deny-closes (503) on a /decide timeout', async () => {
    const decision = await evaluateV2(mappedToolCall, staticDecideClient({ status: 'timeout' }));
    expect(decision.outcome).toBe('not_safely_decided');
    expect(decision.reasonCode).toBe('deadline_exceeded');
    expect(decision.httpStatus).toBe(503);
    expect(decision.adapterCode).toBe('ENFORCE_DECIDE_UNAVAILABLE');
  });

  it('deny-closes (503) on a /decide transport error status', async () => {
    const decision = await evaluateV2(mappedToolCall, staticDecideClient({ status: 'error' }));
    expect(decision.outcome).toBe('not_safely_decided');
    expect(decision.reasonCode).toBe('authority_source_unavailable');
    expect(decision.adapterCode).toBe('ENFORCE_DECIDE_UNAVAILABLE');
  });

  it('deny-closes (503) when the injected client THROWS, leaking no detail', async () => {
    const decision = await evaluateV2(
      mappedToolCall,
      throwingDecideClient(new Error('secret-token=abc123 connection refused')),
    );
    expect(decision.outcome).toBe('not_safely_decided');
    expect(decision.adapterCode).toBe('ENFORCE_DECIDE_UNAVAILABLE');
    // The thrown error's message (which could carry secrets) is never surfaced.
    expect(decision.message).not.toContain('secret-token');
    expect(decision.message).not.toContain('abc123');
  });

  it('deny-closes (503) when a missing service credential makes /decide unconfigured', async () => {
    const decision = await evaluateV2(
      mappedToolCall,
      staticDecideClient({ status: 'credential_unconfigured' }),
    );
    expect(decision.outcome).toBe('not_safely_decided');
    expect(decision.reasonCode).toBe('adapter_config_stale');
    expect(decision.adapterCode).toBe('ENFORCE_DECIDE_UNAVAILABLE');
  });
});

describe('no live decide on no-bundle / unmapped paths', () => {
  it('fails closed (503) when no bundle is active, without calling /decide', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2({ ...mappedToolCall, bundleActive: false }, decide);
    expect(decision.outcome).toBe('not_safely_decided');
    expect(decision.adapterCode).toBe('ENFORCE_NO_VALID_BUNDLE');
    expect(decide).not.toHaveBeenCalled();
  });

  it('denies an unmapped action (403) without calling /decide', async () => {
    const decide = neverCalled();
    const decision = await evaluateV2({ ...mappedToolCall, actionMapped: false }, decide);
    expect(decision.adapterCode).toBe('ENFORCE_ACTION_UNMAPPED');
    expect(decide).not.toHaveBeenCalled();
  });
});

describe('decide deny reason handling', () => {
  it('surfaces an explicit registry deny reason', async () => {
    const decision = await evaluateV2(
      mappedToolCall,
      staticDecideClient({ status: 'deny', reason: 'amount_limit_exceeded' }),
    );
    expect(decision.outcome).toBe('deny');
    expect(decision.reasonCode).toBe('amount_limit_exceeded');
    expect(decision.adapterCode).toBe('ENFORCE_DECISION_DENY');
  });

  it('cannot leak an allow: a non-deny reason on a deny falls back to policy_rule_denied', async () => {
    const decision = await evaluateV2(
      mappedToolCall,
      staticDecideClient({ status: 'deny', reason: 'authorized' }),
    );
    expect(decision.outcome).toBe('deny');
    expect(decision.reasonCode).toBe('policy_rule_denied');
  });
});

describe('trusted context injection', () => {
  it('injects trusted context ONLY on a bound allow', async () => {
    const allow = await evaluateV2(
      mappedToolCall,
      staticDecideClient({ status: 'allow', decisionId: 'fixed-id' }),
    );
    expect(allow.trustedContext).toEqual([
      ['x-mudraid-action-key', 'issue_refund'],
      ['x-mudraid-decision-id', 'fixed-id'],
    ]);

    const deny = await evaluateV2(
      mappedToolCall,
      staticDecideClient({ status: 'deny', reason: 'amount_limit_exceeded' }),
    );
    expect(deny.trustedContext).toEqual([]);
  });

  it('mints a decision id when /decide supplies none', async () => {
    const allow = await evaluateV2(mappedToolCall, staticDecideClient({ status: 'allow' }));
    const idHeader = allow.trustedContext.find(([n]) => n === 'x-mudraid-decision-id');
    expect(idHeader?.[1]).toMatch(/[0-9a-f-]{36}/);
  });
});
