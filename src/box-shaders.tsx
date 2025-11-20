import type { Mesh, ShaderMaterial } from 'three'
import { Color } from 'three'
import { useMemo, useRef, useState } from 'react'
import { useFrame, ThreeElements } from '@react-three/fiber'

// FRAGMENT_SHADER
const fragmentShader = `
uniform float u_time;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
varying float vZ;
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
void main() {
  vec3 color = mix(u_colorA, u_colorB, abs(vZ * 2.0)); 
  vec3 fragRGB = color;
  vec3 fragHSV = rgb2hsv(fragRGB);
  float hueShift = cos(u_time)*0.5;
  fragHSV.x = mod(fragHSV.x + hueShift, 1.0);
  fragRGB = hsv2rgb(fragHSV);
  gl_FragColor = vec4(fragRGB, 1.0);
}
`;
// VERTEX_SHADER
const vertexShader = `
uniform float u_time;
varying float vZ;
void main() {
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  modelPosition.y += sin(modelPosition.x * 5.0 + u_time * 3.0) * sin(u_time)*0.2;
  modelPosition.z += sin(modelPosition.z * 6.0 + u_time * 2.0) * cos(u_time)*0.1;
  vZ = modelPosition.y;
  vec4 viewPosition = viewMatrix * modelPosition;
  vec4 projectedPosition = projectionMatrix * viewPosition;
  gl_Position = projectedPosition;
}
`;

export function BoxShaders(props: ThreeElements['mesh']) {
  const meshRef = useRef<Mesh>(null!)
  const [, setHover] = useState(false)
  const [active, setActive] = useState(false)
  const uniforms = useMemo(
    () => ({
      u_time: {
        value: 0.0,
      },
      u_colorA: { value: new Color("#FF0000") },
      u_colorB: { value: new Color("#00FF00") },
    }), []
  );
  useFrame((state, delta) => {
    const { clock } = state;
    meshRef.current.rotation.x += delta;
    (meshRef.current.material as ShaderMaterial).uniforms.u_time.value = clock.getElapsedTime();
  });
  return (
    <mesh
      {...props}
      ref={meshRef}
      scale={active ? 1.5 : 1}
      onClick={() => setActive(!active)}
      onPointerOver={() => setHover(true)}
      onPointerOut={() => setHover(false)}>
      <boxGeometry args={[1, 1, 1, 20, 20, 20]} />
      <shaderMaterial
        fragmentShader={fragmentShader}
        vertexShader={vertexShader}
        uniforms={uniforms}
        wireframe={false}
      />
    </mesh>
  )
}