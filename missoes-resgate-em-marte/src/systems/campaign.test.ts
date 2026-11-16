// MISSÕES: Testes de desbloqueio, derrota, repetição e ordem das missões.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceCampaign, getCampaignSamples, readCampaignProgress, saveCampaignProgress } from './campaign.ts';
import { MISSIONS } from './missions.ts';

test('campaign unlocks all six missions one victory at a time', () => {
  assert.equal(MISSIONS.length, 6);
  let completed = 0;

  for (const mission of MISSIONS) {
    const result = { phase: 'ended', missionId: mission.id, evacuated: false } as const;
    assert.equal(advanceCampaign(completed, result), completed);
    const victory = { ...result, evacuated: true };
    assert.equal(advanceCampaign(completed, victory), completed + 1);
    completed++;
    assert.equal(advanceCampaign(completed, victory), completed);
  }

  assert.equal(completed, MISSIONS.length);
});

test('a victory out of order cannot skip a locked mission', () => {
  assert.equal(advanceCampaign(0, {
    phase: 'ended',
    missionId: 'sample-cache',
    evacuated: true,
  }), 0);
});


test('campaign restores completed missions and their sample tubes after reading saved storage', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(readCampaignProgress(storage), 0);
  saveCampaignProgress(5, storage);
  saveCampaignProgress(3, storage);

  const reloadedProgress = readCampaignProgress(storage);
  assert.equal(reloadedProgress, 5);
  assert.equal(MISSIONS[reloadedProgress].id, 'sample-cache');
  assert.deepEqual(getCampaignSamples(reloadedProgress), ['M01', 'R01', 'R02', 'S01']);
});
