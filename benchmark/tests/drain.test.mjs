import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForDrain } from '../src/drain.mjs';

function clock() {
  let time = 0;
  return { now: () => time, sleep: async ms => { time += ms; } };
}

test('late broker work resets the six-second empty observation period', async () => {
  const time = clock();
  const observations = [];
  const drained = await waitForDrain(async () => {
    observations.push(time.now());
    return time.now() < 4000 || time.now() >= 7000;
  }, 180000, time);
  assert.equal(drained, true);
  assert.equal(time.now(), 13000);
  assert.ok(observations.includes(4000));
  assert.ok(observations.includes(12000));
});

test('unfinished work and late inspection responses cannot succeed beyond the deadline', async () => {
  const busy = clock();
  assert.equal(await waitForDrain(async () => false, 180000, busy), false);
  assert.equal(busy.now(), 180000);
  const late = clock();
  assert.equal(await waitForDrain(async () => { await late.sleep(5000); return true; }, 10000, late), false);
});
