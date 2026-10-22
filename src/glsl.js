// Shared GLSL snippets.

export const NOISE_GLSL = /* glsl */ `
vec3 mod289(vec3 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x - floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm3(vec3 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ s += a*snoise(p); p = p*2.03 + vec3(1.7,9.2,3.1); a *= 0.5; }
  return s;
}
float fbm5(vec3 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ s += a*snoise(p); p = p*2.01 + vec3(1.7,9.2,3.1); a *= 0.5; }
  return s;
}
// cheap 2D hash / value noise for small details
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
`;

// Bump mapping from a scalar height using screen-space derivatives
// (same approach as three.js perturbNormalArb).
export const BUMP_GLSL = /* glsl */ `
vec3 bumpNormal(vec3 surf_pos, vec3 surf_norm, float h, float fd){
  vec3 vSigmaX = dFdx(surf_pos);
  vec3 vSigmaY = dFdy(surf_pos);
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * fd;
  float dBs = dFdx(h);
  float dBt = dFdy(h);
  vec3 vGrad = sign(fDet) * (dBs * R1 + dBt * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}
`;

// Underwater caustics: two layers of warped ridged noise, sharpened.
export const CAUSTIC_GLSL = /* glsl */ `
uniform float uCaustic;
uniform float uTime;
float causticPattern(vec3 wp){
  vec2 p = wp.xz * 0.9;
  float t = uTime * 0.35;
  float c = 0.0;
  for (int i=0;i<2;i++){
    vec3 q = vec3(p * (1.0 + float(i)*0.7), t*(1.0+float(i)*0.3));
    float n = snoise(q + vec3(snoise(q*0.5+3.1)*0.6));
    c += pow(1.0 - abs(n), 7.0);
  }
  return c;
}
`;
