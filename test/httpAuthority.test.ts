import { describe, expect, it } from 'vitest';
import { HttpAuthority } from '../src/httpAuthority.js';
import { binding } from './bundleFixtures.js';
import { harness } from './authorityFixtures.js';

const invocation = {presentedAuthorization: 'Bearer caller-credential', httpMethod: 'POST', path: '/mcp', contentType: 'application/json', body: Buffer.from('{}')};

describe('authenticated authority', () => {
  it('projects the signed bundle surface onto the strict decision wire contract', async () => {
    const {authority, calls} = harness();
    expect(await authority.refresh()).toBe(true);
    expect(authority.bundle?.surface['domain']).toBe('example.com');
    await authority.decide('read', invocation);
    expect(calls.find(c => c.path === 'decide')?.body.surface).toEqual({
      platform_id: binding.platformId,
      environment: binding.environment,
      canonical_resource_uri: binding.resource,
    });
  });
  it.each([false, true])('transmits exact bounded bytes only for a signed argument profile: %s', async withArguments => {
    const {authority, calls} = harness('allow', undefined, withArguments);
    await authority.refresh();
    expect((await authority.decide('read', invocation)).status).toBe('allow');
    const sent = calls.find(c => c.path === 'decide')?.body.execution;
    expect(sent.body_base64).toBe(withArguments ? invocation.body.toString('base64') : undefined);
  });
  it('refuses an oversized configured argument body before contacting the authority', async () => {
    const {authority, calls} = harness('allow', undefined, true);
    await authority.refresh();
    expect((await authority.decide('read', {...invocation, body: Buffer.alloc(65537)})).status).toBe('error');
    expect(calls.filter(c => c.path === 'decide')).toHaveLength(0);
  });
  it.each(['allow', 'deny'])('reports a verified %s observation on refresh without repeating the decision', async mode => {
    const {authority, calls} = harness(mode);
    await authority.refresh();
    expect(calls.find(c => c.path === 'acknowledgements')?.body.first_observed_decision_at).toBeUndefined();
    await authority.decide('read', invocation);
    await authority.refresh();
    const reports = calls.filter(c => c.path === 'acknowledgements');
    expect(reports).toHaveLength(2);
    expect(typeof reports[1]?.body.first_observed_decision_at).toBe('string');
    expect(reports[1]?.body.active_version).toBe(1);
    expect(calls.filter(c => c.path === 'decide')).toHaveLength(1);
  });
  it('never reports unsigned responses as observed decisions', async () => {
    const {authority, calls} = harness('unsigned');
    await authority.refresh();
    await authority.decide('read', invocation);
    await authority.refresh();
    expect(calls.filter(c => c.path === 'acknowledgements').every(c => c.body.first_observed_decision_at === undefined)).toBe(true);
  });
  it('keeps adapter and caller credentials separate, binds mapping, signs responses, and never retries', async () => {
    const {authority, calls} = harness();
    expect(await authority.refresh()).toBe(true);
    expect((await authority.decide('read', invocation)).status).toBe('allow');
    const decisionCalls = calls.filter(c => c.path === 'decide');
    expect(decisionCalls).toHaveLength(1);
    expect(decisionCalls[0]?.auth).toBe('Bearer adapter-credential');
    expect(decisionCalls[0]?.body.presented_authorization).toBe('Bearer caller-credential');
    expect(decisionCalls[0]?.body.action.action_key).toBe('tasks:read');
    expect(calls.find(c => c.path === 'keys')?.auth).toBeNull();
  });
  it.each(['unsigned', 'replayed', 'altered', 'foreign_action', 'forged_expired_deadline', 'missing_deadline', 'foreign_body', 'missing_execution'])('refuses %s decision', async mode => {
    const {authority} = harness(mode);
    expect(await authority.refresh()).toBe(true);
    expect((await authority.decide('read', invocation)).status).toBe('error');
  });
  it('identifies a verified expired decision without retrying or reporting an observation', async () => {
    const {authority, calls} = harness('expired_deadline');
    expect(await authority.refresh()).toBe(true);
    expect(await authority.decide('read', invocation)).toEqual({status: 'expired'});
    await authority.refresh();
    expect(calls.filter(c => c.path === 'decide')).toHaveLength(1);
    expect(calls.filter(c => c.path === 'acknowledgements').every(c => c.body.first_observed_decision_at === undefined)).toBe(true);
  });
  it.each(['tampered', 'unreachable'])('never activates %s bootstrap', async mode => {
    const {authority, calls} = harness(mode);
    expect(await authority.refresh()).toBe(false);
    expect(authority.bundle).toBeUndefined();
    expect((await authority.decide('read', invocation)).status).toBe('unconfigured');
    expect(calls.filter(c => c.path === 'decide')).toHaveLength(0);
  });
  it('denies unmapped tools without an authority call', async () => {
    const {authority, calls} = harness();
    await authority.refresh();
    expect((await authority.decide('write', invocation)).status).toBe('deny');
    expect(calls.filter(c => c.path === 'decide')).toHaveLength(0);
  });
  it('rejects insecure origins and unbounded timeouts', () => {
    expect(() => new HttpAuthority({apiBase: 'http://api.example.com', adapterToken: 'x', binding})).toThrow();
    expect(() => new HttpAuthority({apiBase: 'https://user:pass@api.example.com', adapterToken: 'x', binding})).toThrow();
    expect(() => new HttpAuthority({apiBase: 'https://api.example.com', adapterToken: 'x', binding, timeoutMs: Infinity})).toThrow();
  });
});
