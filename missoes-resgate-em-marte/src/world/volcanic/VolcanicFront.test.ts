// MISSÕES: Testes de alcance, execução de ações, extração e condições de vitória.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AppBase, EventHandler } from 'playcanvas';
import { InputEvent, VolcanicEvent, WalkerEvent } from '../../systems/events/worldEvents.ts';
import { advanceCampaign, nextCampaignMission } from '../../systems/campaign.ts';
import { getMissionCheckpoints, MISSIONS, type MissionId } from '../../systems/missions.ts';
import { VolcanicFront } from './VolcanicFront.ts';

function setup(mission: MissionId) {
  const app = new EventHandler();
  const front = new VolcanicFront(app as AppBase, mission);
  front.attachSimulation();

  function driveTo({ x, z }: { x: number; z: number }, dt = 1 / 60) {
    app.fire(WalkerEvent.POSE_UPDATED, { x, z, y: 0, headingDeg: 28 });
    app.fire(InputEvent.AXES, { dt });
  }

  const execute = (index: number) => app.fire(VolcanicEvent.COMPLETE_OBJECTIVE, index);
  return { app, front, driveTo, execute };
}

test('a mineral sample requires an action within range during operation', () => {
  const { app, front, driveTo, execute } = setup('mineral-sampling');
  const { target, extraction } = front.getStatus();
  app.fire(VolcanicEvent.START);
  execute(0);
  driveTo(extraction);
  assert.equal(front.getStatus().evacuated, false);
  driveTo({ x: target.x + target.radius + 0.01, z: target.z });
  execute(0);
  assert.equal(front.getStatus().completedCheckpoints, 0);

  driveTo({ x: target.x + target.radius - 0.01, z: target.z });
  assert.equal(front.getStatus().targetDistance, 0);
  assert.equal(front.getStatus().completedCheckpoints, 0);

  app.fire(VolcanicEvent.PAUSE);
  execute(0);
  assert.equal(front.getStatus().completedCheckpoints, 0);
  app.fire(VolcanicEvent.RESUME);
  execute(0);
  execute(0);
  assert.equal(front.getStatus().completedCheckpoints, 1);
  assert.equal(front.getStatus().target, extraction);
  driveTo(extraction);
  assert.equal(front.getStatus().evacuated, true);
});

test('a destroyed walker cannot execute an objective or advance the campaign', () => {
  const { app, front, driveTo, execute } = setup('mineral-sampling');
  app.fire(VolcanicEvent.START);
  driveTo(front.getStatus().target, 300);
  execute(0);
  const status = front.getStatus();
  assert.equal(status.completedCheckpoints, 0);
  assert.equal(status.defeat, 'destruction');
  assert.equal(advanceCampaign(0, status), 0);
  assert.equal(nextCampaignMission(status), undefined);
});

test('each scientific route requires its actions in order and a successful extraction', () => {
  let completed = 0;
  let next: MissionId | undefined = MISSIONS[0].id;
  for (const mission of MISSIONS) {
    assert.equal(next, mission.id);
    const { app, front, driveTo, execute } = setup(next!);
    app.fire(VolcanicEvent.SET_SPEED, 12);
    const { extraction } = front.getStatus();
    const checkpoints = getMissionCheckpoints(mission.id, extraction);
    assert.equal(checkpoints.length, mission.checkpoints.length);
    app.fire(VolcanicEvent.START);
    assert.equal(front.getStatus().speed, 12);

    for (const [index, checkpoint] of checkpoints.entries()) {
      assert.deepEqual(front.getStatus().target, checkpoint);
      driveTo(checkpoint);
      execute(index + 1);
      assert.equal(front.getStatus().completedCheckpoints, index);
      execute(index);
      assert.equal(front.getStatus().completedCheckpoints, index + 1);
      assert.equal(front.getStatus().evacuated, false);
    }

    assert.equal(front.getStatus().target, extraction);
    driveTo(extraction);
    const result = front.getStatus();
    assert.equal(result.evacuated, true);
    completed = advanceCampaign(completed, result);
    next = nextCampaignMission(result);
    front.destroy();
  }

  assert.equal(completed, MISSIONS.length);
  assert.equal(next, undefined);
});

test('the uninterrupted campaign can be driven using the HUD at all difficulties', async t => {
  const { MISSION_CONFIG } = await import('../../systems/missionConfig.ts');
  const { createCratersForSeed, samplePlanetHeight, WORLD_HALF } = await import('../terrain/geology.ts');
  const { createSpiderWalkerState, stepSpiderWalkerKinematics } = await import('../walker/spiderKinematics.ts');
  t.mock.method(Math, 'random', () => 0.75);

  const craters = createCratersForSeed(MISSION_CONFIG.mapSeed);
  const sampleHeight = (x: number, z: number) =>
    samplePlanetHeight(x, z, MISSION_CONFIG.mapSeed, craters);
  const { x, z, headingDeg } = MISSION_CONFIG.walkerSpawn;
  const dt = MISSION_CONFIG.stepSeconds;

  for (const speed of MISSION_CONFIG.volcanic.speedOptions) {
    const { app, front } = setup('mineral-sampling');
    const walker = createSpiderWalkerState(x, z, headingDeg, sampleHeight);
    app.fire(VolcanicEvent.SET_SPEED, speed);
    app.fire(VolcanicEvent.START);
    let status = front.getStatus();

    let completed = 0;
    for (let frame = 0; frame < 12000; frame++) {
      if (status.phase === 'ended') {
        assert.equal(status.evacuated, true, `${status.missionId} at ${speed} UJ/s`);
        completed = advanceCampaign(completed, status);
        const next = nextCampaignMission(status);
        if (!next) break;
        app.fire(VolcanicEvent.CONTINUE_MISSION, next);
        status = front.getStatus();
      }
      if (status.target !== status.extraction && status.targetDistance === 0) {
        app.fire(VolcanicEvent.COMPLETE_OBJECTIVE);
        status = front.getStatus();
      }
      const bearing = status.targetBearing;
      // Same convention as SteampunkWalker: A adds heading and D subtracts heading.
      const right = Math.abs(bearing) > 6 ? Math.sign(bearing) : 0;
      stepSpiderWalkerKinematics(walker, {
        turn: -right,
        forward: Math.abs(bearing) < 40 ? 1 : 0,
        boost: true,
      }, dt, sampleHeight, WORLD_HALF * 0.95);
      app.fire(WalkerEvent.POSE_UPDATED, {
        x: walker.posX, y: walker.posY, z: walker.posZ, headingDeg: walker.headingDeg,
      });
      app.fire(InputEvent.AXES, { dt });
      status = front.getStatus();
    }

    assert.equal(completed, MISSIONS.length, `campaign at ${speed} UJ/s`);
    front.destroy();
  }
});

test('all missions continue from the previous extraction on the same simulation', async () => {
  const { MISSION_CONFIG } = await import('../../systems/missionConfig.ts');
  const { WORLD_HALF } = await import('../terrain/geology.ts');
  const { app, front, driveTo, execute } = setup(MISSIONS[0].id);
  app.fire(VolcanicEvent.SET_SPEED, 6);
  app.fire(VolcanicEvent.START);

  for (const [index, mission] of MISSIONS.entries()) {
    let status = front.getStatus();
    assert.equal(status.phase, 'operation');
    assert.equal(status.missionId, mission.id);
    assert.equal(status.speed, 6);
    assert.equal(status.completedCheckpoints, 0);
    assert(status.extraction.z + status.extraction.radius < WORLD_HALF * 0.95);

    for (let objective = 0; objective < mission.checkpoints.length; objective++) {
      driveTo(front.getStatus().target);
      execute(objective);
    }

    const previousExtraction = status.extraction;
    driveTo(previousExtraction);
    status = front.getStatus();
    assert.equal(status.evacuated, true);

    const next = MISSIONS[index + 1];
    app.fire(VolcanicEvent.CONTINUE_MISSION, next?.id);
    if (next) {
      status = front.getStatus();
      assert.equal(status.phase, 'operation');
      assert.equal(status.missionId, next.id);
      assert.equal(status.distance, MISSION_CONFIG.volcanic.startDistance);
      assert(status.target.z > previousExtraction.z);
      assert(status.extraction.z > status.target.z);
    } else {
      assert.equal(front.getStatus().phase, 'ended');
    }
  }
  front.destroy();
});
