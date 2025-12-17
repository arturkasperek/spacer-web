import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useWorldTime } from "./world-time.js";

interface SkyProps {
  scale?: number;
  sunPosition?: THREE.Vector3;
}

export function SkyComponent({
  scale = 100000,
  sunPosition,
}: SkyProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const { scene, gl, camera } = useThree();

  // Create sky geometry (large box)
  const skyGeometry = useMemo(() => {
    return new THREE.BoxGeometry(1, 1, 1);
  }, []);

  // PMREM generator for environment mapping
  const pmremGenerator = useMemo(() => {
    return new THREE.PMREMGenerator(gl);
  }, [gl]);

  // Create custom shader material implementing Preetham atmospheric scattering
  const skyMaterial = useMemo(() => {
    const vertexShader = `
      precision highp float;
      precision highp int;
      varying vec3 vWorldPosition;
      varying vec3 vSunDirection;
      varying float vSunfade;
      varying vec3 vBetaR;
      varying vec3 vBetaM;
      varying float vSunE;

      uniform vec3 sunPosition;
      uniform vec3 upUniform;
      uniform float turbidity;
      uniform float rayleigh;
      uniform float mieCoefficient;
      uniform float mieDirectionalG;

      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w; // set z to camera.far

        // constants for atmospheric scattering
        float e = 2.71828182845904523536028747135266249775724709369995957;
        float pi = 3.141592653589793238462643383279502884197169;

        // wavelength of used primaries, according to preetham
        vec3 totalRayleigh = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);

        // mie stuff
        vec3 MieConst = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);

        // earth shadow hack
        float cutoffAngle = 1.6110731556870734;
        float steepness = 1.5;
        float EE = 1000.0;

        // varying sun position
        vec3 sunDirection = normalize(sunPosition);
        vSunDirection = sunDirection;

        // varying sun intensity
        float angle = dot(sunDirection, upUniform);
        float zenithAngleCos = clamp(angle, -1.0, 1.0);
        float sunIntensity = EE * max(0.0, 1.0 - pow(e, -(cutoffAngle - acos(zenithAngleCos)) / steepness));
        vSunE = sunIntensity;

        // varying sun fade
        float sunfade = 1.0 - clamp(1.0 - exp(sunPosition.y / 450000.0), 0.0, 1.0);
        vSunfade = sunfade;

        // varying vBetaR
        float rayleighCoefficient = rayleigh - 1.0 * (1.0 - sunfade);

        // extinction (absorption + out scattering)
        // rayleigh coefficients
        vBetaR = totalRayleigh * rayleighCoefficient;

        // varying vBetaM
        float c = 0.2 * turbidity * 10E-18;
        vec3 totalMie = 0.434 * c * MieConst;

        vBetaM = totalMie * mieCoefficient;
      }
    `;

    const fragmentShader = `
      precision highp float;
      precision highp int;
      varying vec3 vWorldPosition;
      varying vec3 vSunDirection;
      varying float vSunfade;
      varying vec3 vBetaR;
      varying vec3 vBetaM;
      varying float vSunE;

      uniform vec3 cameraPos;
      uniform vec3 upUniform;
      uniform float mieDirectionalG;

      void main() {
        // constants for atmospheric scattering
        float pi = 3.141592653589793238462643383279502884197169;

        // optical length at zenith for molecules
        float rayleighZenithLength = 8.4E3;
        float mieZenithLength = 1.25E3;
        // 66 arc seconds -> degrees, and the cosine of that
        float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

        // 3.0 / (16.0 * pi)
        float THREE_OVER_SIXTEENPI = 0.05968310365946075;
        // 1.0 / (4.0 * pi)
        float ONE_OVER_FOURPI = 0.07957747154594767;

        vec3 direction = normalize(vWorldPosition - cameraPosition);

        // optical length
        // cutoff angle at 90 to avoid singularity in next formula.
        float zenithAngle = acos(max(0.0, dot(upUniform, direction)));
        float inverse = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - (zenithAngle * 180.0) / pi, -1.253));
        float sR = rayleighZenithLength * inverse;
        float sM = mieZenithLength * inverse;

        // combined extinction factor
        vec3 Fex = exp(-(vBetaR * sR + vBetaM * sM));

        // in scattering
        float cosTheta = dot(direction, vSunDirection);

        // betaRTheta
        float c = cosTheta * 0.5 + 0.5;
        float rPhase = THREE_OVER_SIXTEENPI * (1.0 + pow(c, 2.0));
        vec3 betaRTheta = vBetaR * rPhase;

        // betaMTheta
        float g2 = pow(mieDirectionalG, 2.0);
        float inv = 1.0 / pow(1.0 - 2.0 * mieDirectionalG * cosTheta + g2, 1.5);
        float mPhase = ONE_OVER_FOURPI * (1.0 - g2) * inv;
        vec3 betaMTheta = vBetaM * mPhase;

        vec3 Lin = pow(vSunE * (betaRTheta + betaMTheta) / (vBetaR + vBetaM) * (1.0 - Fex), vec3(1.5));
        Lin = Lin * mix(vec3(1.0), pow(vSunE * (betaRTheta + betaMTheta) / (vBetaR + vBetaM) * Fex, vec3(1.0 / 2.0)), clamp(pow(1.0 - dot(upUniform, vSunDirection), 5.0), 0.0, 1.0));

        // nightsky
        vec3 L0 = vec3(0.1) * Fex * 1.0;

        // composition + solar disc (match reference values)
        float sundisk = smoothstep(sunAngularDiameterCos, sunAngularDiameterCos + 0.00001, cosTheta);
        L0 = L0 + vSunE * 19000.0 * Fex * sundisk;

        vec3 texColor = (Lin + L0) * 0.02 + vec3(0.0, 0.0003, 0.00075);

        vec3 retColor = pow(texColor, vec3(1.0 / (1.2 + vSunfade * 1.2)));

        gl_FragColor = vec4(retColor, 1.0);
      }
    `;

    return new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        sunPosition: { value: sunPosition || new THREE.Vector3(0, 1, 0) },
        upUniform: { value: new THREE.Vector3(0, 1, 0) },
        turbidity: { value: 10 },
        rayleigh: { value: 0.82 },
        mieCoefficient: { value: 0.001 },
        mieDirectionalG: { value: 0.8 },
        cameraPos: { value: new THREE.Vector3() },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
  }, [sunPosition]);

  // Store sky geometry in state for PMREM generation
  const [currentSkyGeometry] = useMemo(() => [skyGeometry], []);

  // Update camera position uniform and generate environment map
  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.cameraPos.value.copy(state.camera.position);
    }
  });

  // Drive sun position from game time (Gothic-like) unless explicitly overridden via prop.
  // Update only when displayed world time changes (minute granularity), not every frame.
  const wt = useWorldTime();
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;

    if (sunPosition) {
      mat.uniforms.sunPosition.value.copy(sunPosition);
      return;
    }

    const dayFrac = ((wt.hour * 60 + wt.minute) % 1440) / 1440;
    const az = dayFrac * Math.PI * 2;
    const elevAng = Math.sin((dayFrac - 0.25) * Math.PI * 2) * (Math.PI / 2);
    const cosEl = Math.cos(elevAng);

    // Match shader's sunfade scale (450000) so day/night transitions look correct.
    const SUN_SCALE = 450000;
    mat.uniforms.sunPosition.value
      .set(Math.cos(az) * cosEl, Math.sin(elevAng), Math.sin(az) * cosEl)
      .multiplyScalar(SUN_SCALE);
  }, [sunPosition, wt.hour, wt.minute]);

  // Generate environment map when sun position changes
  useEffect(() => {
    if (skyMaterial && pmremGenerator && currentSkyGeometry) {
      const timer = setTimeout(() => {
        try {
          // Create a temporary scene for PMREM generation
          const tempScene = new THREE.Scene();
          const tempSky = new THREE.Mesh(currentSkyGeometry, skyMaterial);
          tempSky.scale.setScalar(scale);
          tempScene.add(tempSky);

          // Generate PMREM environment map
          const envMap = pmremGenerator.fromScene(tempScene);

          // Set as scene environment
          scene.environment = envMap.texture;

          // Cleanup temp scene
          tempScene.remove(tempSky);

        } catch (error: unknown) {
          console.warn('PMREM generation failed:', error);
        }
      }, 100);

      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [skyMaterial, pmremGenerator, scene, scale, currentSkyGeometry]);

  if (!skyMaterial) return null;

  // Set material reference for updates
  useEffect(() => {
    if (meshRef.current && skyMaterial) {
      meshRef.current.material = skyMaterial;
      materialRef.current = skyMaterial;
    }
  }, [skyMaterial]);

  // Make sky follow the camera position
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.position.copy(camera.position);
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={skyGeometry}
      scale={[scale, scale, scale]}
    />
  );
}
