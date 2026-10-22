// Procedural ground shading for the three settings.
import * as THREE from 'three';
import { NOISE_GLSL, BUMP_GLSL, CAUSTIC_GLSL } from './glsl.js';
import { sharedUniforms } from './stones.js';

export function makeGroundMaterial(mode, params = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const col = (h) => new THREE.Color(h);
  const uniforms = {
    uGrassA: { value: col(params.grassA ?? 0x5b6b2e) },
    uGrassB: { value: col(params.grassB ?? 0x8f8547) },
    uGrassC: { value: col(params.grassC ?? 0x3d4a22) },
    uHighCol: { value: col(params.highCol ?? 0x6b4a3a) },
    uHighStart: { value: params.highStart ?? 999 },
    uRockCol: { value: col(params.rockCol ?? 0x9a9a95) },
    uRockAmt: { value: params.rockAmt ?? 0 },
    uSoil: { value: col(params.soil ?? 0x3f2f22) },
    uSand: { value: col(params.sand ?? 0xb9a57c) },
    uWallL: { value: params.wallL ?? 3 },
    uWallW: { value: params.wallW ?? 0.72 },
    uWorn: { value: params.worn ?? 1 },
    uCity: { value: new THREE.Vector4(-8, 8, -6, 5.5) }, // lot rect
  };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, sharedUniforms);
    shader.defines = shader.defines || {};
    shader.defines['MODE_' + mode.toUpperCase()] = 1;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGPos = (modelMatrix * vec4(transformed,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${NOISE_GLSL}
        ${BUMP_GLSL}
        ${CAUSTIC_GLSL}
        varying vec3 vGPos;
        uniform vec3 uGrassA, uGrassB, uGrassC, uHighCol, uRockCol, uSoil, uSand;
        uniform float uHighStart, uRockAmt, uWallL, uWallW, uWorn;
        uniform vec4 uCity;
        float gH; float gR;
        vec3 soilColor(vec2 wp){
          float n = snoise(vec3(wp*3.0, 1.0)) * 0.5 + snoise(vec3(wp*11.0, 2.0)) * 0.3;
          vec3 c = uSoil * (0.8 + 0.3 * n);
          float pebble = smoothstep(0.72, 0.8, snoise(vec3(wp*26.0, 5.0)));
          c = mix(c, vec3(0.42, 0.40, 0.37), pebble * 0.7);
          gH += pebble * 0.004 + n * 0.002;
          return c;
        }
        float trenchMask(vec2 wp){
          float n = snoise(vec3(wp*4.0, 9.0)) * 0.04;
          float mz = 1.0 - smoothstep(uWallW*0.5 + 0.0, uWallW*0.5 + 0.16, abs(wp.y) + n);
          float mx = 1.0 - smoothstep(uWallL*0.5 + 0.1, uWallL*0.5 + 0.4, abs(wp.x) + n);
          return mz * mx;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 wp = vGPos.xz;
          float dist = length(vGPos - cameraPosition);
          float detailFade = 1.0 - smoothstep(25.0, 80.0, dist);
          gH = 0.0; gR = 0.0;
          vec3 c;
          #ifdef MODE_FIELD
            float big = fbm3(vec3(wp * 0.006, 0.0));
            float mid = fbm3(vec3(wp * 0.045, 1.0));
            float fine = snoise(vec3(wp * 1.9, 2.0));
            float fine2 = snoise(vec3(wp * 8.0, 3.0));
            c = mix(uGrassA, uGrassB, smoothstep(-0.35, 0.45, big * 0.8 + mid * 0.45));
            c = mix(c, uGrassC, smoothstep(0.15, 0.65, mid * 0.8 - big * 0.3) * 0.7);
            c *= 0.86 + (0.12 * fine + 0.07 * fine2) * detailFade;
            // tussocks and clover flecks close up
            float tuft = smoothstep(0.35, 0.7, snoise(vec3(wp * 4.5, 4.0)));
            c = mix(c, uGrassB * 1.1, tuft * 0.25 * detailFade);
            gH += (fine * 0.006 + fine2 * 0.003 + tuft * 0.004) * detailFade;
            // high ground: bracken / heather
            float hs = smoothstep(uHighStart, uHighStart + 10.0, vGPos.y + fbm3(vec3(wp*0.02, 6.0)) * 8.0);
            c = mix(c, uHighCol * (0.85 + 0.2 * mid), hs);
            // limestone pavement
            float pav = smoothstep(0.5, 0.56, fbm3(vec3(wp * 0.05, 8.0)) + 0.1 * snoise(vec3(wp*0.8, 2.0))) * uRockAmt;
            float grike = smoothstep(0.88, 0.97, abs(sin(wp.x * 1.3 + snoise(vec3(wp*0.4, 1.0)) * 2.0)));
            vec3 rc = uRockCol * (0.85 + 0.15 * fine2) * (1.0 - grike * 0.6);
            c = mix(c, rc, pav);
            gR += pav * -0.15;
            // worn ground around the work area and the trench soil
            float worn = (1.0 - smoothstep(2.0, 4.5, abs(wp.y))) * (1.0 - smoothstep(uWallL*0.5 + 1.5, uWallL*0.5 + 3.5, abs(wp.x)));
            worn *= smoothstep(-0.2, 0.5, snoise(vec3(wp * 1.2, 7.0))) * uWorn;
            c = mix(c, mix(c, uSoil * 1.4, 0.45), worn * 0.55);
            float tm = trenchMask(wp);
            if (tm > 0.001) c = mix(c, soilColor(wp), tm);
          #endif
          #ifdef MODE_CITY
            float fine = snoise(vec3(wp * 2.0, 2.0));
            float fine2 = snoise(vec3(wp * 9.0, 3.0));
            bool inLot = wp.x > uCity.x && wp.x < uCity.y && wp.y > uCity.z && wp.y < uCity.w;
            if (inLot) {
              float mid = fbm3(vec3(wp * 0.3, 1.0));
              c = mix(uGrassA, uGrassB, smoothstep(-0.3, 0.5, mid));
              c *= 0.86 + 0.12 * fine + 0.07 * fine2;
              float bare = smoothstep(0.3, 0.6, fbm3(vec3(wp*0.5, 3.0)));
              c = mix(c, uSoil * 1.3, bare * 0.5);
              gH += fine * 0.006 + fine2 * 0.003;
              float worn = (1.0 - smoothstep(1.6, 3.6, abs(wp.y))) * (1.0 - smoothstep(uWallL*0.5 + 1.2, uWallL*0.5 + 3.0, abs(wp.x)));
              c = mix(c, uSoil * 1.4, worn * 0.35 * smoothstep(-0.2, 0.5, snoise(vec3(wp*1.2, 7.0))));
              float tm = trenchMask(wp);
              if (tm > 0.001) c = mix(c, soilColor(wp), tm);
            } else {
              // street vs sidewalk bands along z
              float z = wp.y;
              bool street = (z > 7.0 && z < 16.0) || (abs(wp.x) > 26.0 && abs(wp.x) < 35.0);
              if (street) {
                vec3 asph = vec3(0.13, 0.13, 0.135) * (0.85 + 0.2 * fine + 0.1 * fine2);
                float agg = smoothstep(0.6, 0.8, snoise(vec3(wp * 40.0, 1.0)));
                asph += agg * 0.05;
                // patches & tar seams
                float patchy = smoothstep(0.4, 0.42, fbm3(vec3(wp * 0.15, 4.0)));
                asph *= 1.0 - patchy * 0.25;
                // lane markings (along x)
                float dash = step(0.5, fract(wp.x / 6.0)) * (1.0 - smoothstep(0.05, 0.07, abs(z - 11.5)));
                float edge = (1.0 - smoothstep(0.05, 0.07, abs(z - 8.0))) + (1.0 - smoothstep(0.05, 0.07, abs(z - 15.0)));
                float paint = clamp(dash + edge, 0.0, 1.0) * (0.75 + 0.25 * fine2) * step(abs(wp.x), 26.0);
                c = mix(asph, vec3(0.78, 0.72, 0.5), paint);
                gR = -0.1 + paint * 0.1;
                gH += fine2 * 0.002 + agg * 0.001;
              } else {
                // concrete flags with joints
                vec2 g = wp / 1.5;
                vec2 f = abs(fract(g) - 0.5);
                float joint = smoothstep(0.485, 0.495, max(f.x, f.y));
                vec2 id = floor(g);
                float tone = hash12(id) * 0.12;
                c = vec3(0.56, 0.55, 0.52) * (0.85 + tone + 0.08 * fine + 0.05 * fine2);
                float stain = smoothstep(0.3, 0.7, fbm3(vec3(wp*0.4, 6.0)));
                c *= 1.0 - stain * 0.18;
                c = mix(c, c * 0.45, joint);
                gH += -joint * 0.004 + fine2 * 0.0015;
              }
            }
          #endif
          #ifdef MODE_SAND
            float big = fbm3(vec3(wp * 0.05, 0.0));
            float fine = snoise(vec3(wp * 3.0, 2.0));
            float fine2 = snoise(vec3(wp * 14.0, 3.0));
            vec2 rd = normalize(vec2(0.9, 0.42));
            float warp = fbm3(vec3(wp * 0.25, 1.0)) * 2.2;
            float rip = sin(dot(wp, rd) * 18.0 + warp * 3.0);
            float ripple = pow(rip * 0.5 + 0.5, 1.6);
            c = uSand * (0.88 + 0.12 * big + 0.06 * fine + 0.05 * fine2);
            c *= 0.9 + 0.12 * ripple;
            float shell = smoothstep(0.78, 0.84, snoise(vec3(wp * 22.0, 6.0)));
            c = mix(c, vec3(0.86, 0.82, 0.74), shell * 0.6);
            float dark = smoothstep(0.2, 0.6, fbm3(vec3(wp * 0.12, 9.0)));
            c = mix(c, c * vec3(0.55, 0.62, 0.5), dark * 0.4);
            gH += (ripple * 0.012 + fine2 * 0.002) * detailFade;
            float tm = trenchMask(wp);
            if (tm > 0.001) { c = mix(c, uSand * 0.62, tm); }
          #endif
          diffuseColor.rgb = c;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + gR, 0.2, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = bumpNormal(-vViewPosition, normal, gH * 6.0, faceDirection);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef MODE_SAND
          totalEmissiveRadiance += diffuseColor.rgb * causticPattern(vGPos) * uCaustic;
        #endif`);
  };
  mat.customProgramCacheKey = () => 'ground-' + mode;
  return mat;
}
