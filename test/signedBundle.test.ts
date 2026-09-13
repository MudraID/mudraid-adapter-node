import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson, verifyBundle } from '../src/signedBundle.js';
import { bundle, keys, binding, now } from './bundleFixtures.js';

describe('signed bundle verification', () => {
  it('verifies a Unicode bundle signed by the production Python signing functions', () => {
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/python-signed-bundle.json', import.meta.url), 'utf8'));
    const verified = verifyBundle(fixture.envelope, fixture.keys, fixture.binding, undefined, now);
    expect(verified.actions['read']?.['description']).toBe('café 😀 \u007f');
    fixture.envelope.payload.content.matcher.actions[0].description = 'changed';
    expect(() => verifyBundle(fixture.envelope, fixture.keys, fixture.binding, undefined, now)).toThrow();
  });
  it('matches Python ASCII escaping and Unicode code-point key ordering', () => {
    expect(canonicalJson({'😀': 2, '\ue000': 1, x: 'é\u007f\n'})).toBe('{"x":"\\u00e9\\u007f\\n","\\ue000":1,"\\ud83d\\ude00":2}');
    expect(() => canonicalJson({n: 1.5})).toThrow();
    expect(() => canonicalJson({n: Number.MAX_SAFE_INTEGER + 1})).toThrow();
  });
  it('activates a material-free, immutable exact action mapping', () => {
    const result = verifyBundle(bundle(), keys, binding, undefined, now);
    expect(result.actions['read']?.['action_key']).toBe('tasks:read');
    expect(result.actions['READ']).toBeUndefined();
    expect(Object.isFrozen(result.actions['read'])).toBe(true);
  });
  it('refuses content tampering and signature stripping', () => {
    const tampered = bundle();
    tampered.payload.content.matcher.actions[0]!.action_key = 'tasks:write';
    expect(() => verifyBundle(tampered, keys, binding, undefined, now)).toThrow();
    expect(() => verifyBundle({...bundle(), signature_value: undefined}, keys, binding, undefined, now)).toThrow();
  });
  it('refuses another tenant, resource, environment, unknown key, and expired window', () => {
    for (const bad of [{...binding, platformId: 'other'}, {...binding, environment: 'production'}, {...binding, resource: 'https://other.example'}]) {
      expect(() => verifyBundle(bundle(), keys, bad, undefined, now)).toThrow();
    }
    expect(() => verifyBundle(bundle(), {}, binding, undefined, now)).toThrow();
    expect(() => verifyBundle(bundle(), keys, binding, undefined, now + 86400001)).toThrow();
  });
  it('rejects rollback and same-version conflicts while allowing an unchanged refresh', () => {
    const active = verifyBundle(bundle(2), keys, binding, undefined, now);
    expect(() => verifyBundle(bundle(1), keys, binding, active, now)).toThrow();
    expect(() => verifyBundle(bundle(2), keys, binding, {...active, digest: 'other'}, now)).toThrow();
    expect(verifyBundle(bundle(2), keys, binding, active, now).digest).toBe(active.digest);
  });
});
