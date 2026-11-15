import * as pc from 'playcanvas';
import type { Vec2XZ } from '../../types/index.ts';
import { createFractureMapTexture } from './fracture-map.ts';

export const DEFAULT_CRATER_RADIUS = 160;

const SHARED_IMPACT_UNIFORMS = `
  uniform sampler2D uFractureMap;
  uniform vec2 uImpactCenter;
  uniform float uSpreadRadius;
  uniform float uShockwaveRadius;
  uniform float uCraterRadius;
  uniform float uTime;
`;

export const volcanicTransform = `
  ${SHARED_IMPACT_UNIFORMS}
  #ifdef PIXELSNAP
  uniform vec4 screen_size;
  #endif
  #ifdef SCREENSPACE
  uniform float projectionFlipY;
  #endif

  float vsImpactEffDist(vec3 posW, out float rawDist) {
    vec2 delta = posW.xz - uImpactCenter;
    rawDist = length(delta);
    vec2 dir = delta / max(rawDist, 1.0);
    float lobe = (dir.x * dir.x - dir.y * dir.y) * 14.0
               + (dir.x * dir.y) * 20.0
               + sin(dir.x * 5.0 - dir.y * 4.0) * 9.0
               + cos(dir.x * 9.0 + dir.y * 7.0) * 5.0;
    float relief = clamp(-posW.y * 0.45, -24.0, 28.0);
    float blend = smoothstep(4.0, 32.0, rawDist);
    return max(0.0, rawDist - (lobe + relief) * blend);
  }

  float vsImpactDisplacement(vec3 posW) {
    float activeReach = max(uSpreadRadius, uShockwaveRadius);
    if (activeReach <= 0.001) return 0.0;

    float rawDist = 0.0;
    float effDist = vsImpactEffDist(posW, rawDist);
    if (effDist > activeReach + 24.0) return 0.0;

    float disp = 0.0;
    float safeCrater = max(uCraterRadius, 1.0);
    vec4 fracTex = textureLod(uFractureMap, posW.xz * 0.0032, 0.0);
    float fineTex = textureLod(uFractureMap, posW.xz * 0.0095, 0.0).b;

    float craterWarp = (fracTex.r - 0.5) * 36.0 + (fineTex - 0.5) * 22.0;
    float warpedCraterDist = max(0.0, rawDist + craterWarp * smoothstep(0.0, safeCrater * 0.4, rawDist));
    float craterBlast = clamp(uSpreadRadius / (safeCrater * 0.35), 0.0, 1.0);
    float blastRing = exp(-uSpreadRadius * 0.003) * sin(rawDist * 0.11 - uTime * 24.0) * 7.5;

    if (warpedCraterDist < safeCrater * 1.85 && craterBlast > 0.001) {
      float rNorm = warpedCraterDist / safeCrater;
      float rawBowl = smoothstep(0.92, 0.06, rNorm);
      float terracedBowl = mix(rawBowl, floor(rawBowl * 4.0) / 4.0, 0.38);
      float bowl = -46.0 * terracedBowl;
      float centralPeak = 14.5 * exp(-(rNorm * rNorm) / 0.032) * (0.65 + 0.85 * fracTex.r);
      float rimDelta = (rNorm - 1.02) / 0.28;
      float rim = 23.5 * exp(-(rimDelta * rimDelta) / 0.88) * (0.55 + 0.9 * fracTex.g + 0.4 * fineTex);
      disp += (bowl + centralPeak + rim + blastRing * smoothstep(1.7, 0.2, rNorm)) * craterBlast;
    }

    float pen = uSpreadRadius - effDist;
    if (pen > -18.0 && uSpreadRadius > 0.01) {
      float buckleDelta = pen - 8.0;
      float crustBuckle = exp(-(buckleDelta * buckleDelta) / 340.0)
                        * (8.5 + 10.5 * fracTex.r + 5.0 * sin(posW.x * 0.18 + posW.z * 0.16 - uTime * 18.0))
                        * smoothstep(0.0, 14.0, uSpreadRadius);
      float chasmSink = smoothstep(0.74, 0.96, fracTex.r) * smoothstep(12.0, 75.0, pen) * 9.2;
      float slabTilt = smoothstep(0.55, 0.82, fracTex.g)
                     * (1.0 - smoothstep(0.84, 0.96, fracTex.r))
                     * smoothstep(4.0, 35.0, pen) * 4.8;
      disp += crustBuckle + slabTilt - chasmSink;
    }

    if (uShockwaveRadius > 0.5) {
      float swDelta = (effDist - uShockwaveRadius) / 18.0;
      disp += 7.5 * exp(-(swDelta * swDelta)) * (1.0 - smoothstep(500.0, 3000.0, uShockwaveRadius));
    }

    return disp;
  }

  vec4 evalWorldPosition(vec3 vertexPosition, mat4 modelMatrix) {
    vec3 localPos = getLocalPosition(vertexPosition);
    #ifdef NINESLICED
      localPos.xz *= outerScale;
      vec2 positiveUnitOffset = clamp(vertexPosition.xz, vec2(0.0), vec2(1.0));
      vec2 negativeUnitOffset = clamp(-vertexPosition.xz, vec2(0.0), vec2(1.0));
      localPos.xz += (-positiveUnitOffset * innerOffset.xy + negativeUnitOffset * innerOffset.zw) * vertex_texCoord0.xy;
      vTiledUv = (localPos.xz - outerScale + innerOffset.xy) * -0.5 + 1.0;
      localPos.xz *= -0.5;
      localPos = localPos.xzy;
    #endif
    vec4 posW = modelMatrix * vec4(localPos, 1.0);
    posW.y += vsImpactDisplacement(posW.xyz);
    #ifdef SCREENSPACE
      posW.zw = vec2(0.0, 1.0);
    #endif
    return posW;
  }

  vec4 getPosition() {
    dModelMatrix = getModelMatrix();
    vec4 posW = evalWorldPosition(vertex_position.xyz, dModelMatrix);
    dPositionW = posW.xyz;
    vec4 screenPos;
    #ifdef UV1LAYOUT
      screenPos = vec4(vertex_texCoord1.xy * 2.0 - 1.0, 0.5, 1);
      #ifdef WEBGPU
        screenPos.y *= -1.0;
      #endif
    #else
      #ifdef SCREENSPACE
        screenPos = posW;
        screenPos.y *= projectionFlipY;
      #else
        screenPos = matrix_viewProjection * posW;
      #endif
      #ifdef PIXELSNAP
        screenPos.xy = (screenPos.xy * 0.5) + 0.5;
        screenPos.xy *= screen_size.xy;
        screenPos.xy = floor(screenPos.xy);
        screenPos.xy *= screen_size.zw;
        screenPos.xy = (screenPos.xy * 2.0) - 1.0;
      #endif
    #endif
    return screenPos;
  }

  vec3 getWorldPosition() {
    return dPositionW;
  }
`;

export const volcanicDiffuse = `
  uniform vec3 material_diffuse;
  ${SHARED_IMPACT_UNIFORMS}

  float psDiffImpactEffDist(vec3 posW, out float rawDist) {
    vec2 delta = posW.xz - uImpactCenter;
    rawDist = length(delta);
    vec2 dir = delta / max(rawDist, 1.0);
    float lobe = (dir.x * dir.x - dir.y * dir.y) * 14.0
               + (dir.x * dir.y) * 20.0
               + sin(dir.x * 5.0 - dir.y * 4.0) * 9.0
               + cos(dir.x * 9.0 + dir.y * 7.0) * 5.0;
    float relief = clamp(-posW.y * 0.45, -24.0, 28.0);
    float blend = smoothstep(4.0, 32.0, rawDist);
    return max(0.0, rawDist - (lobe + relief) * blend);
  }

  void getAlbedo() {
    vec3 baseColor = material_diffuse * clamp(vVertexColor.rgb, 0.0, 1.0);
    float activeReach = max(uSpreadRadius, uShockwaveRadius);
    if (activeReach <= 0.001) {
      dAlbedo = baseColor;
      return;
    }

    float rawDist = 0.0;
    float effDist = psDiffImpactEffDist(vPositionW, rawDist);
    if (effDist > activeReach + 24.0) {
      dAlbedo = baseColor;
      return;
    }

    vec2 baseUv = vPositionW.xz * 0.0032;
    float warpA = texture2D(uFractureMap, baseUv * 0.65).a;
    float warpB = texture2D(uFractureMap, baseUv * 0.65 + vec2(0.37, 0.71)).a;
    vec2 warpedUv = baseUv + (vec2(warpA, warpB) - 0.5) * 0.045;
    vec4 fracSample = texture2D(uFractureMap, warpedUv);
    float basaltGrain = texture2D(uFractureMap, baseUv * 2.97).b;

    float pen = uSpreadRadius - effDist;
    vec3 rockColor = baseColor;

    if (pen > -10.0 && uSpreadRadius > 0.01) {
      float stage1 = smoothstep(-8.0, 12.0, pen);
      float stage2 = smoothstep(22.0, 92.0, pen);

      float macroDry = smoothstep(0.72 - 0.09 * stage2, 0.92, fracSample.r) * stage1;
      float microDry = smoothstep(0.78 - 0.06 * stage2, 0.95, fracSample.g) * stage1;
      float crackShadow = clamp(max(macroDry, microDry * 0.84), 0.0, 1.0);

      // Scorched Martian rock, shattered rim ejecta, and dark volcanic basalt slabs
      float ashMask = smoothstep(0.20, 0.85, basaltGrain);
      vec3 scorchedMars = baseColor * mix(0.62, 0.15, ashMask * 0.75 + stage2 * 0.25);
      vec3 darkBasalt = vec3(0.045, 0.032, 0.028) * (0.50 + 0.75 * basaltGrain);
      vec3 slabColor = mix(scorchedMars, darkBasalt, stage2 * 0.80);
      vec3 craterBasalt = vec3(0.022, 0.014, 0.012) * (0.50 + 0.70 * basaltGrain);

      float safeCrater = max(uCraterRadius, 1.0);
      float craterWarp = (fracSample.r - 0.5) * 36.0 + (basaltGrain - 0.5) * 22.0;
      float warpedCraterDist = max(0.0, rawDist + craterWarp * smoothstep(0.0, safeCrater * 0.4, rawDist));
      float craterBlast = clamp(uSpreadRadius / (safeCrater * 0.35), 0.0, 1.0);
      float craterMask = (1.0 - smoothstep(safeCrater * 0.52, safeCrater * 1.48, warpedCraterDist)) * craterBlast;
      slabColor = mix(slabColor, craterBasalt, craterMask * 0.92);

      // Violent black fissures snap open first across crust heave, then slabs darken
      rockColor = mix(baseColor, slabColor, smoothstep(-6.0, 22.0, pen) * 0.95);
      rockColor = mix(rockColor, vec3(0.007, 0.005, 0.004), crackShadow * 0.97);
    }

    if (uShockwaveRadius > 0.5) {
      float swAppear = smoothstep(1.0, 18.0, uShockwaveRadius);
      float swDecay = 1.0 - smoothstep(500.0, 3000.0, uShockwaveRadius);
      float swDelta = (effDist - uShockwaveRadius) / 16.0;
      float shockRing = exp(-(swDelta * swDelta)) * swAppear * swDecay;
      float scorchTail = smoothstep(uShockwaveRadius + 18.0, uShockwaveRadius - 55.0, effDist)
                       * smoothstep(uShockwaveRadius - 140.0, uShockwaveRadius - 25.0, effDist)
                       * swAppear * swDecay;
      rockColor = mix(rockColor, rockColor * 0.42, scorchTail * 0.52);
      rockColor = mix(rockColor, rockColor + vec3(0.48, 0.26, 0.12), shockRing * 0.88);
    }

    dAlbedo = rockColor;
  }
`;

export const volcanicEmission = `
  ${SHARED_IMPACT_UNIFORMS}

  float psEmisImpactEffDist(vec3 posW, out float rawDist) {
    vec2 delta = posW.xz - uImpactCenter;
    rawDist = length(delta);
    vec2 dir = delta / max(rawDist, 1.0);
    float lobe = (dir.x * dir.x - dir.y * dir.y) * 14.0
               + (dir.x * dir.y) * 20.0
               + sin(dir.x * 5.0 - dir.y * 4.0) * 9.0
               + cos(dir.x * 9.0 + dir.y * 7.0) * 5.0;
    float relief = clamp(-posW.y * 0.45, -24.0, 28.0);
    float blend = smoothstep(4.0, 32.0, rawDist);
    return max(0.0, rawDist - (lobe + relief) * blend);
  }

  void getEmission() {
    dEmission = vec3(0.0);
    float activeReach = max(uSpreadRadius, uShockwaveRadius);
    if (activeReach <= 0.001) return;

    float rawDist = 0.0;
    float effDist = psEmisImpactEffDist(vPositionW, rawDist);
    if (effDist > activeReach + 24.0) return;

    vec2 baseUv = vPositionW.xz * 0.0032;
    float warpA = texture2D(uFractureMap, baseUv * 0.65).a;
    float warpB = texture2D(uFractureMap, baseUv * 0.65 + vec2(0.37, 0.71)).a;
    vec2 warpedUv = baseUv + (vec2(warpA, warpB) - 0.5) * 0.045;
    vec4 fracSample = texture2D(uFractureMap, warpedUv);
    float basaltGrain = texture2D(uFractureMap, baseUv * 2.97).b;

    vec3 emission = vec3(0.0);
    float pen = uSpreadRadius - effDist;
    float safeCrater = max(uCraterRadius, 1.0);
    float craterWarp = (fracSample.r - 0.5) * 36.0 + (basaltGrain - 0.5) * 22.0;
    float warpedCraterDist = max(0.0, rawDist + craterWarp * smoothstep(0.0, safeCrater * 0.4, rawDist));
    float craterBlast = clamp(uSpreadRadius / (safeCrater * 0.35), 0.0, 1.0);

    // Stage 3a: Boiling impact melt sheet & ring fractures inside jagged crater floor (excludes central peak apex)
    if (uSpreadRadius > 0.01 && warpedCraterDist < safeCrater * 1.15) {
      float rNorm = warpedCraterDist / safeCrater;
      float rimMelt = (1.0 - smoothstep(0.28, 0.84, rNorm)) * smoothstep(0.05, 0.20, rNorm);
      float ringFissures = smoothstep(0.68, 0.96, fracSample.r) * (1.0 - smoothstep(0.66, 1.15, rNorm));
      float meltMask = clamp(rimMelt + ringFissures * 0.94, 0.0, 1.0) * craterBlast;
      if (meltMask > 0.001) {
        float boilWave = sin(vPositionW.x * 0.09 + uTime * 3.1) * cos(vPositionW.z * 0.09 - uTime * 2.7) * 0.20;
        float crustIslands = smoothstep(0.32, 0.72, basaltGrain + boilWave) * (1.0 - smoothstep(0.38, 0.78, fracSample.r));
        float poolMolten = clamp(1.22 - crustIslands * 0.76 + fracSample.r * 0.58, 0.0, 1.5);
        float corePulse = 0.88 + 0.24 * sin(uTime * 4.2 + vPositionW.x * 0.11 - vPositionW.z * 0.10);
        vec3 craterMagma = mix(vec3(2.4, 0.48, 0.05), vec3(5.2, 2.8, 0.85), clamp(poolMolten - 0.25, 0.0, 1.0));
        emission += craterMagma * meltMask * corePulse * 1.35;
      }
    }

    // Stage 1 (pen < 22m) has ZERO lava glow: violent dry crust cracking & buckling first.
    // Stage 2 (pen >= 22m) surges fierce magma up through the split fault chasms.
    if (pen > 22.0 && uSpreadRadius > 0.01) {
      float stage2 = smoothstep(22.0, 88.0, pen);
      float thermalBreath = 0.84 + 0.24 * sin(uTime * 2.4 + vPositionW.x * 0.07 + vPositionW.z * 0.09);
      float veinDetail = 0.56 + 0.72 * basaltGrain;

      float macroSlit = smoothstep(0.81 - 0.10 * stage2, 0.95, fracSample.r) * stage2;
      float macroHeart = smoothstep(0.89 - 0.04 * stage2, 0.985, fracSample.r) * stage2;
      float microVein = smoothstep(0.90 - 0.035 * stage2, 0.985, fracSample.g) * stage2 * 0.58;

      vec3 deepEmber = vec3(1.85, 0.28, 0.025) * macroSlit * veinDetail;
      vec3 brightAmber = vec3(3.6, 1.1, 0.12) * (macroHeart + microVein * 0.60) * veinDetail;
      emission += (deepEmber + brightAmber) * thermalBreath;

      // Stage 3b: Central tectonic artery spines radiating from the impact basin
      float centralZone = (1.0 - smoothstep(safeCrater * 0.85, safeCrater * 4.2, rawDist)) * stage2;
      if (centralZone > 0.001) {
        float arterySpine = smoothstep(0.85, 0.978, fracSample.r) * centralZone;
        float arteryPulse = 0.84 + 0.28 * sin(uTime * 3.4 - rawDist * 0.06);
        emission += vec3(4.8, 2.2, 0.65) * arterySpine * arteryPulse;
      }
    }

    // Wide supersonic shockwave thermal ring (~32m ring)
    if (uShockwaveRadius > 0.5) {
      float swAppear = smoothstep(1.0, 18.0, uShockwaveRadius);
      float swDecay = 1.0 - smoothstep(500.0, 3000.0, uShockwaveRadius);
      float swDelta = (effDist - uShockwaveRadius) / 16.0;
      float shockRing = exp(-(swDelta * swDelta)) * swAppear * swDecay;
      emission += vec3(2.8, 1.45, 0.45) * shockRing * (0.45 + 0.55 * basaltGrain) * 1.25;
    }

    dEmission = emission;
  }
`;

export function createVolcanicTerrainMaterial(
  device: pc.GraphicsDevice,
  impactCenter: Vec2XZ,
): { material: pc.StandardMaterial; fractureTexture: pc.Texture } {
  const fractureTexture = createFractureMapTexture(device);
  const material = new pc.StandardMaterial();
  material.diffuse = new pc.Color(1, 1, 1);
  material.diffuseVertexColor = true;
  material.shininess = 18;

  const chunks = material.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
  chunks.set('transformVS', volcanicTransform);
  chunks.set('diffusePS', volcanicDiffuse);
  chunks.set('emissivePS', volcanicEmission);
  material.shaderChunksVersion = '2.24';

  material.setParameter('uFractureMap', fractureTexture);
  material.setParameter('uImpactCenter', [impactCenter.x, impactCenter.z]);
  material.setParameter('uSpreadRadius', 0);
  material.setParameter('uShockwaveRadius', 0);
  material.setParameter('uCraterRadius', DEFAULT_CRATER_RADIUS);
  material.setParameter('uTime', 0);
  material.update();

  return { material, fractureTexture };
}
