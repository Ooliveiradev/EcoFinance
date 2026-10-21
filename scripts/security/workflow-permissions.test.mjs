import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

test('PR jobs stay read-only and only the production main deployment receives OIDC',()=> {
  const ci=parse(readFileSync('.github/workflows/ci.yml','utf8'));
  assert.deepEqual(ci.permissions,{contents:'read'});
  assert.equal(ci.on.pull_request_target,undefined);
  for(const job of Object.values(ci.jobs))assert.equal(job.permissions,undefined);
  const deploy=parse(readFileSync('.github/workflows/deploy.yml','utf8'));
  assert.deepEqual(deploy.permissions,{});
  // Manual only (Vercel is the primary host); the job itself still refuses any ref but main.
  assert.deepEqual(Object.keys(deploy.on),['workflow_dispatch']);
  assert.equal(deploy.on.pull_request,undefined);assert.equal(deploy.on.pull_request_target,undefined);
  assert.equal(Object.keys(deploy.jobs).length,1);
  const job=deploy.jobs.deploy;
  assert.equal(job.if,"github.ref == 'refs/heads/main'");
  assert.deepEqual(job.permissions,{contents:'read','id-token':'write'});
  assert.equal(job.environment.name,'production');
  for(const workflow of [ci,deploy])for(const job of Object.values(workflow.jobs))for(const step of job.steps??[]) {
    if(step.uses?.startsWith('actions/checkout@'))assert.equal(step.with['persist-credentials'],false);
  }
});
