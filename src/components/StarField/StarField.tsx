import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { FeaturedFormula, SearchFormula } from '../../types/formula';
import { chapterColor } from '../../utils/constants';
import { useStarFieldStore } from '../../stores/starFieldStore';
import { FormulaTooltip } from '../common/FormulaTooltip';
import './StarField.css';

interface StarFieldProps {
  featured: FeaturedFormula[];
  searchIndex: SearchFormula[];
  visible: boolean;
}

interface NodeMesh extends THREE.Mesh {
  userData: {
    formula: FeaturedFormula;
    baseScale: number;
  };
}

export function StarField({ featured, searchIndex, visible }: StarFieldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const asleep = useStarFieldStore((state) => state.asleep);
  const asleepRef = useRef(asleep);
  const visibleRef = useRef(visible);
  const [hovered, setHovered] = useState<{ formula: FeaturedFormula; x: number; y: number } | null>(null);
  const lookup = useMemo(() => new Map(searchIndex.map((item) => [item.id, item])), [searchIndex]);

  useEffect(() => {
    asleepRef.current = asleep;
  }, [asleep]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !featured.length) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x06060f, 7, 15);
    const camera = new THREE.PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 8.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.35, 0.5, 0.12));

    const ambient = new THREE.AmbientLight(0x9fc7ff, 1.2);
    const directional = new THREE.DirectionalLight(0xffffff, 2.2);
    directional.position.set(4, 3, 5);
    scene.add(ambient, directional);

    const group = new THREE.Group();
    scene.add(group);

    const sphereGeometry = new THREE.SphereGeometry(3, 96, 96);
    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e7aa6,
      roughness: 0.48,
      metalness: 0.12,
      transparent: true,
      opacity: 0.78,
      emissive: 0x12344f,
      emissiveIntensity: 0.22,
    });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    group.add(sphere);

    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(3.035, 48, 48),
      new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.07, wireframe: true }),
    );
    group.add(wire);

    const nodeGeometry = new THREE.SphereGeometry(0.045, 12, 12);
    const nodes: NodeMesh[] = [];
    const points = fibonacciSphere(featured.length, 3.08);
    featured.forEach((formula, index) => {
      const chapter = Number(formula.chapter);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(chapterColor(chapter)),
        emissive: new THREE.Color(chapterColor(chapter)),
        emissiveIntensity: 1.1,
        roughness: 0.25,
      });
      const mesh = new THREE.Mesh(nodeGeometry, material) as unknown as NodeMesh;
      mesh.position.copy(points[index]);
      mesh.userData = { formula, baseScale: 1 };
      nodes.push(mesh);
      group.add(mesh);
    });

    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(1200 * 3);
    for (let i = 0; i < starPositions.length; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 28;
      starPositions[i + 1] = (Math.random() - 0.5) * 18;
      starPositions[i + 2] = -Math.random() * 18;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xdbeafe, size: 0.018, transparent: true, opacity: 0.8 }));
    scene.add(stars);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredMesh: NodeMesh | null = null;
    let running = false;

    const setPointer = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(nodes, false)[0]?.object as NodeMesh | undefined;
      if (hoveredMesh && hoveredMesh !== hit) {
        hoveredMesh.scale.setScalar(hoveredMesh.userData.baseScale);
      }
      hoveredMesh = hit || null;
      if (hoveredMesh) {
        hoveredMesh.scale.setScalar(1.9);
        setHovered({ formula: hoveredMesh.userData.formula, x: event.clientX, y: event.clientY });
      } else {
        setHovered(null);
      }
    };

    const click = () => {
      if (hoveredMesh && visibleRef.current && !asleepRef.current) {
        navigate(`/graph/${hoveredMesh.userData.formula.id}`);
      }
    };

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      composer.setSize(mount.clientWidth, mount.clientHeight);
    };

    const animate = () => {
      if (asleepRef.current || !visibleRef.current) {
        renderer.setAnimationLoop(null);
        running = false;
        return;
      }
      group.rotation.y += 0.0015;
      group.rotation.x = Math.sin(performance.now() * 0.00012) * 0.08;
      stars.rotation.y -= 0.0002;
      composer.render();
    };

    const wake = () => {
      if (!running && !asleepRef.current && visibleRef.current) {
        running = true;
        renderer.setAnimationLoop(animate);
      }
    };

    renderer.domElement.addEventListener('pointermove', setPointer);
    renderer.domElement.addEventListener('pointerleave', () => setHovered(null));
    renderer.domElement.addEventListener('click', click);
    window.addEventListener('resize', resize);
    wake();

    const visibilityTimer = window.setInterval(wake, 250);
    const unsubscribe = useStarFieldStore.subscribe((state) => {
      asleepRef.current = state.asleep;
      if (!state.asleep) wake();
      else {
        renderer.setAnimationLoop(null);
        running = false;
      }
    });

    return () => {
      window.clearInterval(visibilityTimer);
      unsubscribe();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointermove', setPointer);
      renderer.domElement.removeEventListener('click', click);
      window.removeEventListener('resize', resize);
      composer.dispose();
      renderer.dispose();
      sphereGeometry.dispose();
      sphereMaterial.dispose();
      wire.geometry.dispose();
      (wire.material as THREE.Material).dispose();
      nodeGeometry.dispose();
      nodes.forEach((node) => (node.material as THREE.Material).dispose());
      starGeometry.dispose();
      (stars.material as THREE.Material).dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [featured, navigate]);

  return (
    <div ref={mountRef} className={`starfield-root ${visible ? 'starfield-root--visible' : 'starfield-root--hidden'}`} aria-hidden={!visible}>
      <div className="evolution-overlay" />
      {hovered ? <FormulaTooltip formula={hovered.formula} searchFormula={lookup.get(hovered.formula.id)} x={hovered.x} y={hovered.y} /> : null}
    </div>
  );
}

function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = goldenAngle * i;
    points.push(new THREE.Vector3(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius));
  }
  return points;
}
