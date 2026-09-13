import {describe, expect, it} from 'vitest';
import {bindExecution} from '../src/executionBinding.js';
import vector from './fixtures/execution-binding.json';
import argumentsVector from './fixtures/action-arguments.json';

const request = vector.request;
const snapshot = {version: request.bundle.version, digest: request.bundle.payload_digest,
  expiresAt: Date.now() + 60000, surface: request.surface, actions: {pay: request.action}};
const context = {presentedAuthorization: request.presented_authorization,
  httpMethod: request.request.http_method, path: request.request.path,
  contentType: request.execution.content_type, body: Buffer.from(vector.body)};

describe('exact execution request binding', () => {
  it('matches the independent Python vector including Unicode body bytes', () => {
    const result = bindExecution(snapshot, request.action, context);
    expect(result.digest).toBe(vector.expected_digest);
    expect(result.execution).toEqual(request.execution);
  });
  it.each([
    vector.body.replace('1250', '1251'),
    vector.body.replace('café-😀', 'different-recipient'),
    vector.body + ' ',
  ])('changed amount, recipient or bytes cannot reuse a binding', body => {
    expect(bindExecution(snapshot, request.action, {...context, body: Buffer.from(body)}).digest).not.toBe(vector.expected_digest);
  });
  it('binds caller, HTTP target and content type', () => {
    for (const change of [{presentedAuthorization: 'Bearer another'}, {path: '/other'}, {httpMethod: 'PUT'}, {contentType: 'application/json; charset=utf-8'}]) {
      expect(bindExecution(snapshot, request.action, {...context, ...change}).digest).not.toBe(vector.expected_digest);
    }
  });
  it('refuses incomplete or oversized snapshots', () => {
    expect(() => bindExecution(snapshot, {}, context)).toThrow();
    expect(() => bindExecution(snapshot, request.action, {...context, body: Buffer.alloc(8 * 1024 * 1024 + 1)})).toThrow();
    expect(() => bindExecution(snapshot, request.action, {...context, contentType: ''})).toThrow();
  });
});

describe('owner-configured action arguments', () => {
  const action = {...request.action, argument_profile: argumentsVector.profile};
  it('sends the unchanged bytes under the same digest for independent authority parsing', () => {
    const result = bindExecution(snapshot, action, context);
    expect(result.digest).toBe(vector.expected_digest);
    expect(result.execution['body_base64']).toBe(Buffer.from(vector.body).toString('base64'));
  });
  it.each([0, 65537])('refuses a configured argument body of %i bytes', size => {
    expect(() => bindExecution(snapshot, action, {...context, body: Buffer.alloc(size)})).toThrow();
  });
  it('does not send request contents without a configured profile', () => {
    expect(bindExecution(snapshot, request.action, context).execution).not.toHaveProperty('body_base64');
  });
});
