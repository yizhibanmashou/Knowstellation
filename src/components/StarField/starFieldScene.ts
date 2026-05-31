import * as THREE from 'three';
import type { StarNode } from '../../utils/starNavigation';

export function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const safeCount = Math.max(1, count);
  for (let i = 0; i < count; i += 1) {
    const y = 1 - ((i + 0.5) / safeCount) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * (i + 0.5);
    points.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
  }
  return points;
}

export function createBiologicalFilaments(points: THREE.Vector3[], nodes: StarNode[]): THREE.Line[] {
  const lines: THREE.Line[] = [];
  const sortedIndexes = [...points.keys()].sort((a, b) => (nodes[a]?.chapterRank || 0) - (nodes[b]?.chapterRank || 0));
  const chapterMap = nodes.every((node) => node.kind === 'chapter');
  const formulaMap = nodes.every((node) => node.kind === 'formula');
  const usedEdges = new Set<string>();
  const addLine = (startIndex: number | undefined, endIndex: number | undefined, opacity: number, curvature: number, role: 'trunk' | 'near' | 'distant') => {
    if (startIndex === undefined || endIndex === undefined || startIndex === endIndex) return;
    const edgeKey = [startIndex, endIndex].sort((a, b) => a - b).join(':');
    if (usedEdges.has(edgeKey)) return;
    usedEdges.add(edgeKey);
    lines.push(createFilament(points[startIndex], points[endIndex], opacity, curvature, role));
  };

  sortedIndexes.forEach((pointIndex, sortedPosition) => {
    const next = sortedIndexes[sortedPosition + 1];
    const nearBridge = sortedIndexes[sortedPosition + 2];
    const bridge = sortedIndexes[sortedPosition + 3];
    const wideBridge = sortedIndexes[sortedPosition + 5];
    if (!formulaMap || sortedPosition % 3 === 0) addLine(pointIndex, next, chapterMap ? 0.32 : formulaMap ? 0.155 : 0.22, 0.26, 'trunk');
    if (nearBridge !== undefined && sortedPosition % (formulaMap ? 6 : 3) === 0) addLine(pointIndex, nearBridge, chapterMap ? 0.12 : formulaMap ? 0.058 : 0.082, 0.36, 'distant');
    if (bridge !== undefined && sortedPosition % (formulaMap ? 10 : 4) === 1) addLine(pointIndex, bridge, chapterMap ? 0.082 : formulaMap ? 0.04 : 0.058, 0.46, 'distant');
    if (!formulaMap && wideBridge !== undefined && sortedPosition % 8 === 2) addLine(pointIndex, wideBridge, chapterMap ? 0.05 : 0.045, 0.54, 'distant');
  });

  points.forEach((point, index) => {
    const closest = points
      .map((candidate, candidateIndex) => ({ candidateIndex, distance: candidate.distanceTo(point) }))
      .filter((item) => item.candidateIndex !== index)
      .sort((a, b) => a.distance - b.distance)
      .filter((item) => item.candidateIndex > index && item.distance < (chapterMap ? 2.38 : formulaMap ? 1.66 : 2.2))
      .slice(0, chapterMap ? (index % 4 === 0 ? 3 : 2) : formulaMap ? (index % 8 === 0 ? 2 : 1) : index % 5 === 0 ? 3 : 2);
    closest.forEach((item, nearestIndex) =>
      addLine(
        index,
        item.candidateIndex,
        chapterMap
          ? nearestIndex === 0
            ? 0.14
            : nearestIndex === 1
              ? 0.085
              : nearestIndex === 2
                ? 0.05
                : 0.032
          : nearestIndex === 0
            ? formulaMap
              ? 0.052
              : 0.09
            : nearestIndex === 1
              ? formulaMap
                ? 0.034
                : 0.058
              : 0.04,
        chapterMap ? 0.24 : formulaMap ? 0.14 : 0.18,
        'near',
      ),
    );
  });

  return lines;
}

function createFilament(start: THREE.Vector3, end: THREE.Vector3, opacity: number, curvature: number, role: 'trunk' | 'near' | 'distant'): THREE.Line {
  const mid = start.clone().add(end).multiplyScalar(0.5);
  const normal = mid.clone().normalize().multiplyScalar(curvature * (0.55 + Math.random() * 0.22));
  const tangent = new THREE.Vector3().crossVectors(start, end).normalize().multiplyScalar(curvature * 0.08 * (Math.random() - 0.5));
  const curve = new THREE.CatmullRomCurve3([
    start.clone(),
    start.clone().lerp(end, 0.25).add(normal.clone().multiplyScalar(0.58)).add(tangent),
    start.clone().lerp(end, 0.5).add(normal),
    start.clone().lerp(end, 0.75).add(normal.clone().multiplyScalar(0.58)).sub(tangent),
    end.clone(),
  ]);
  const curvePoints = curve.getPoints(role === 'distant' ? 44 : 36);
  const geometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
  const colors = new Float32Array(curvePoints.length * 3);
  const alphas = new Float32Array(curvePoints.length);
  const progress = new Float32Array(curvePoints.length);
  const white = new THREE.Color(0xffffff);
  const blue = new THREE.Color(role === 'distant' ? 0x93c5fd : 0xdbeafe);
  const cyan = new THREE.Color(0x67e8f9);
  for (let i = 0; i < curvePoints.length; i++) {
    const t = i / (curvePoints.length - 1);
    const centerGlow = Math.sin(t * Math.PI);
    const color = white.clone().lerp(blue, centerGlow * 0.4).lerp(cyan, role === 'trunk' ? centerGlow * 0.22 : centerGlow * 0.1);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    alphas[i] = Math.pow(centerGlow, role === 'trunk' ? 0.92 : 1.28) * (role === 'near' ? 0.86 : 1);
    progress[i] = t;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('lineProgress', new THREE.BufferAttribute(progress, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    vertexColors: true,
    uniforms: {
      opacity: { value: opacity },
      time: { value: 0 },
      softness: { value: role === 'trunk' ? 0.12 : 0.22 },
    },
    vertexShader: `
      attribute float alpha;
      attribute float lineProgress;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vProgress;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vProgress = lineProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      uniform float time;
      uniform float softness;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vProgress;
      void main() {
        float drift = sin((vProgress * 22.0) + (gl_FragCoord.x * 0.035) + (gl_FragCoord.y * 0.018) + time * 0.28);
        float brokenLight = smoothstep(-0.52 - softness, 0.72, drift);
        float breath = 0.72 + 0.28 * sin(time * 0.7 + vProgress * 6.2831);
        float alpha = opacity * vAlpha * mix(0.58, 1.0, brokenLight) * breath;
        gl_FragColor = vec4(vColor, alpha);
      }
    `,
  });
  const line = new THREE.Line(geometry, material);
  line.userData.baseOpacity = opacity;
  return line;
}

export function createDust(count: number, size: number, opacity: number, minRadius: number, radiusRange: number, zOffset: number): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const colorA = new THREE.Color(0xffffff);
  const colorB = new THREE.Color(0xcbd5e1);
  const colorC = new THREE.Color(0xa5b4fc);
  for (let i = 0; i < count; i += 1) {
    const stride = i * 3;
    const radius = minRadius + Math.random() * radiusRange;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
    positions[stride] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[stride + 1] = Math.cos(phi) * radius * 0.74;
    positions[stride + 2] = Math.sin(phi) * Math.sin(theta) * radius + zOffset;
    const mixed = colorA.clone().lerp(Math.random() < 0.3 ? colorC : colorB, Math.random() * 0.55);
    colors[stride] = mixed.r;
    colors[stride + 1] = mixed.g;
    colors[stride + 2] = mixed.b;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size, transparent: true, opacity, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }),
  );
}

export function makeLabelSprite(text: string, fontSize: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = `850 ${fontSize}px Inter, system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = 'rgba(255, 255, 255, 0.68)';
    context.shadowBlur = 8;
    context.fillStyle = 'rgba(2, 6, 23, 0.92)';
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  return new THREE.Sprite(material);
}
