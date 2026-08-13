/**
 * Portable-corpus PARITY test.
 *
 * Loads the EP-120-US-02 adapter-decision corpus and asserts the Node control
 * loop reproduces EVERY fixture's expected outcome + adapter code. This is the
 * parity oracle: the same facts must produce the same allow/deny/deny-closed
 * outcome as the Kong Lua handler, the reference runner, and the Python
 * middleware.
 *
 * Provenance: `test/fixtures/adapter-decision-corpus.json` is a pinned snapshot
 * of
 * `shared/mudraid_contracts/mudraid_contracts/data/adapters/adapter-decision-corpus.json`
 * (contract `mudraid.adapter.decision/1`), copied so this package stays
 * self-contained and `npm ci`-installable in isolation. If the upstream corpus
 * changes, refresh this snapshot and re-run.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { evaluateV2 } from '../src/controlLoop.js';
import type {
  DecideClient,
  DecideResult,
  DecideStatus,
  JsonShape,
  Outcome,
  ReasonTier,
  RequestFacts,
} from '../src/types.js';
import { ADAPTER_DECISION_CONTRACT_VERSION } from '../src/types.js';

interface CorpusFactsRaw {
  readonly protected?: boolean;
  readonly reserved_headers_presented?: readonly string[];
  readonly bundle_active?: boolean;
  readonly method?: string;
  readonly body_readable?: boolean;
  readonly body_too_large?: boolean;
  readonly json_shape?: JsonShape;
  readonly jsonrpc?: string | null;
  readonly rpc_method?: string | null;
  readonly tool_name?: string | null;
  readonly action_mapped?: boolean;
  readonly decide?: DecideStatus;
  readonly decide_reason?: string;
}

interface CorpusExpect {
  readonly outcome: Outcome;
  readonly reason_code: string;
  readonly reason_tier: ReasonTier;
  readonly http_status: number;
  readonly adapter_code: string | null;
  readonly stripped_reserved_headers: readonly string[];
}

interface CorpusFixture {
  readonly id: string;
  readonly category: string;
  readonly description: string;
  readonly facts: CorpusFactsRaw;
  readonly expect: CorpusExpect;
}

interface Corpus {
  readonly contract_version: string;
  readonly fixtures: readonly CorpusFixture[];
}

const corpusPath = fileURLToPath(
  new URL('./fixtures/adapter-decision-corpus.json', import.meta.url),
);
const corpus = JSON.parse(readFileSync(corpusPath, 'utf-8')) as Corpus;

/** Map a corpus `facts` object onto typed {@link RequestFacts}. */
function toRequestFacts(raw: CorpusFactsRaw): RequestFacts {
  const facts: RequestFacts = {
    protected: raw.protected ?? true,
    bundleActive: raw.bundle_active ?? true,
    method: raw.method ?? 'POST',
    ...(raw.reserved_headers_presented !== undefined
      ? { reservedHeadersPresented: raw.reserved_headers_presented }
      : {}),
    ...(raw.body_readable !== undefined ? { bodyReadable: raw.body_readable } : {}),
    ...(raw.body_too_large !== undefined ? { bodyTooLarge: raw.body_too_large } : {}),
    ...(raw.json_shape !== undefined ? { jsonShape: raw.json_shape } : {}),
    ...(raw.jsonrpc !== undefined ? { jsonrpc: raw.jsonrpc } : {}),
    ...(raw.rpc_method !== undefined ? { rpcMethod: raw.rpc_method } : {}),
    ...(raw.tool_name !== undefined ? { toolName: raw.tool_name } : {}),
    ...(raw.action_mapped !== undefined ? { actionMapped: raw.action_mapped } : {}),
  };
  return facts;
}

/**
 * Build a `/decide` seam from the fixture's `decide` fact, recording whether it
 * was invoked. Fixtures with no `decide` fact MUST never reach the live call —
 * we assert `called === false` for them.
 */
function decideSeam(raw: CorpusFactsRaw): { client: DecideClient; called: () => boolean } {
  let invoked = false;
  const client: DecideClient = async (): Promise<DecideResult> => {
    invoked = true;
    if (raw.decide === undefined) {
      throw new Error('decide called for a fixture with no decide fact');
    }
    const result: DecideResult = {
      status: raw.decide,
      ...(raw.decide_reason !== undefined ? { reason: raw.decide_reason } : {}),
    };
    return result;
  };
  return { client, called: () => invoked };
}

describe('adapter-decision corpus parity', () => {
  it('snapshot matches the pinned contract version', () => {
    expect(corpus.contract_version).toBe(ADAPTER_DECISION_CONTRACT_VERSION);
  });

  it('covers a non-trivial corpus', () => {
    expect(corpus.fixtures.length).toBeGreaterThanOrEqual(20);
  });

  for (const fixture of corpus.fixtures) {
    it(`[${fixture.category}] ${fixture.id}`, async () => {
      const { client, called } = decideSeam(fixture.facts);
      const decision = await evaluateV2(toRequestFacts(fixture.facts), client);

      expect(decision.outcome).toBe(fixture.expect.outcome);
      expect(decision.reasonCode).toBe(fixture.expect.reason_code);
      expect(decision.reasonTier).toBe(fixture.expect.reason_tier);
      expect(decision.httpStatus).toBe(fixture.expect.http_status);
      expect(decision.adapterCode).toBe(fixture.expect.adapter_code);
      expect([...decision.strippedReservedHeaders]).toEqual([
        ...fixture.expect.stripped_reserved_headers,
      ]);

      // The live /decide seam is reached ONLY at the decide branch (a mapped
      // tools/call on an active bundle). A fixture may still carry a decide fact
      // while the loop short-circuits earlier (e.g. no bundle, or a malformed
      // action name) — that is correct. The safety invariant is the converse: a
      // fixture with NO decide fact must NEVER trigger a live call.
      if (fixture.facts.decide === undefined) {
        expect(called()).toBe(false);
      }
    });
  }
});
