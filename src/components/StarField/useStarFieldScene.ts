import { useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import type { StarNode } from '../../utils/starNavigation';
import { useStarFieldStore } from '../../stores/starFieldStore';
import {
  CLICK_DRAG_THRESHOLD,
  DOUBLE_CLICK_MISS_THRESHOLD,
  DOUBLE_CLICK_WINDOW_MS,
  NODE_RADIUS,
} from './starFieldConstants';
import { createBiologicalFilaments, createDust, fibonacciSphere } from './starFieldScene';
import { createStarNodeObjects } from './starFieldNodes';
import type { ActiveNode, HitTargetMesh, NodeMesh } from './starFieldTypes';

interface UseStarFieldSceneParams {
  asleepRef: MutableRefObject<boolean>;
  mountRef: RefObject<HTMLDivElement>;
  onEnterNode: (node: StarNode) => void;
  rotationSpeedRef: MutableRefObject<number>;
  selectedRef: MutableRefObject<boolean>;
  setActiveNode: Dispatch<SetStateAction<ActiveNode | null>>;
  setHoverNode: Dispatch<SetStateAction<ActiveNode | null>>;
  setRenderError: Dispatch<SetStateAction<string | null>>;
  starNodes: StarNode[];
  visibleRef: MutableRefObject<boolean>;
}

export function useStarFieldScene({
  asleepRef,
  mountRef,
  onEnterNode,
  rotationSpeedRef,
  selectedRef,
  setActiveNode,
  setHoverNode,
  setRenderError,
  starNodes,
  visibleRef,
}: UseStarFieldSceneParams) {
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !starNodes.length) return;
    setRenderError(null);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030611, 0.085);

    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, 0.1, 80);
    camera.position.set(0, 0.18, 8.6);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch (error) {
      console.error('LitGraph star map WebGL initialization failed', error);
      setRenderError('星图 3D 渲染暂不可用，已切换为静态星空背景。');
      return;
    }
    renderer.setClearColor(0x030611, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.42;
    mount.appendChild(renderer.domElement);

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;
    let bokehPass: BokehPass | null = null;

    if (!isMobile) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      bloomPass = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 1.62, 0.64, 0.14);
      bokehPass = new BokehPass(scene, camera, { focus: 8.22, aperture: 0.00026, maxblur: 0.009 });
      composer.addPass(renderPass);
      composer.addPass(bokehPass);
      composer.addPass(bloomPass);
    }

    scene.add(new THREE.AmbientLight(0x87b9ff, 0.55));
    const keyLight = new THREE.PointLight(0xffffff, 2.4, 16);
    keyLight.position.set(-3.4, 2.5, 4.6);
    const rimLight = new THREE.PointLight(0xe5e7eb, 1.2, 18);
    rimLight.position.set(4.2, -2.4, -2.8);
    scene.add(keyLight, rimLight);

    const constellation = new THREE.Group();
    scene.add(constellation);

    const coreGeometry = new THREE.SphereGeometry(2.1, 96, 96);
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: 0x071728,
      roughness: 0.74,
      metalness: 0.08,
      transparent: true,
      opacity: 0.22,
      emissive: 0x071a2d,
      emissiveIntensity: 0.28,
    });
    const core = new THREE.Mesh(coreGeometry, coreMaterial);
    constellation.add(core);

    const nodePoints = fibonacciSphere(starNodes.length, NODE_RADIUS);
    const nodeObjects = createStarNodeObjects(constellation, starNodes, nodePoints);
    const { hitTargets, nodeMeshes } = nodeObjects;

    const filamentLines = createBiologicalFilaments(nodePoints, starNodes);
    const filamentBaseOpacities = filamentLines.map((line) => Number(line.userData.baseOpacity || 0.07));
    filamentLines.forEach((line) => constellation.add(line));

    const dust = createDust(4200, 0.018, 0.58, 5, 18, -4);
    const fineDust = createDust(3200, 0.009, 0.42, 7, 24, -7);
    scene.add(dust, fineDust);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Mesh.threshold = 0.02;
    const pointer = new THREE.Vector2();
    const lastPointer = { x: 0, y: 0 };
    const dragStart = { x: 0, y: 0 };
    let pressed = false;
    let dragging = false;
    let hoveredMesh: NodeMesh | null = null;
    let pinnedMesh: NodeMesh | null = null;
    let clickTimer: number | null = null;
    let lastClick: { node: StarNode; nodeId: string; time: number; x: number; y: number } | null = null;
    let running = false;

    const clearSelection = () => {
      if (pinnedMesh) pinnedMesh.userData.targetScale = pinnedMesh.userData.baseScale;
      pinnedMesh = null;
      selectedRef.current = false;
      setActiveNode(null);
    };

    const releaseHover = () => {
      if (hoveredMesh && hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale;
      hoveredMesh = null;
      setHoverNode(null);
    };

    const pinNode = (mesh: NodeMesh) => {
      if (pinnedMesh && pinnedMesh !== mesh) pinnedMesh.userData.targetScale = pinnedMesh.userData.baseScale;
      pinnedMesh = mesh;
      hoveredMesh = mesh;
      selectedRef.current = true;
      mesh.userData.targetScale = mesh.userData.baseScale * 1.5;
    };

    const updatePointer = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
    };

    const pickNode = (event: PointerEvent) => {
      updatePointer(event);
      const hit = raycaster.intersectObjects(hitTargets, false)[0]?.object as HitTargetMesh | undefined;
      return hit?.userData.node;
    };

    const setHoverFromEvent = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current || dragging) return;
      const hit = pickNode(event);
      if (hoveredMesh && hoveredMesh !== hit && hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale;
      hoveredMesh = hit || null;
      renderer.domElement.style.cursor = hoveredMesh ? 'pointer' : 'grab';
      if (hoveredMesh) {
        if (hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale * 1.35;
        setHoverNode({ node: hoveredMesh.userData.node, x: event.clientX, y: event.clientY });
      } else {
        setHoverNode(null);
      }
    };

    const pointerDown = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current) return;
      pressed = true;
      dragging = false;
      dragStart.x = event.clientX;
      dragStart.y = event.clientY;
      lastPointer.x = event.clientX;
      lastPointer.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };

    const pointerMove = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current) return;
      if (pressed) {
        const dx = event.clientX - dragStart.x;
        const dy = event.clientY - dragStart.y;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) dragging = true;
        if (dragging) {
          constellation.rotation.y += (event.clientX - lastPointer.x) * 0.0032;
          constellation.rotation.x += (event.clientY - lastPointer.y) * 0.0024;
          constellation.rotation.x = THREE.MathUtils.clamp(constellation.rotation.x, -0.62, 0.62);
          renderer.domElement.style.cursor = 'grabbing';
          lastPointer.x = event.clientX;
          lastPointer.y = event.clientY;
          return;
        }
      }
      setHoverFromEvent(event);
    };

    const pointerUp = (event: PointerEvent) => {
      if (!pressed || asleepRef.current || !visibleRef.current) return;
      renderer.domElement.releasePointerCapture(event.pointerId);
      pressed = false;
      renderer.domElement.style.cursor = 'grab';
      if (dragging) {
        dragging = false;
        return;
      }

      const hit = pickNode(event);
      const now = window.performance.now();
      if (!hit) {
        const previousClick = lastClick;
        const isMissedSecondClick =
          previousClick &&
          now - previousClick.time <= DOUBLE_CLICK_WINDOW_MS &&
          Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) <= DOUBLE_CLICK_MISS_THRESHOLD;
        if (isMissedSecondClick) {
          if (clickTimer !== null) window.clearTimeout(clickTimer);
          onEnterNode(previousClick.node);
          lastClick = null;
          return;
        }
        clearSelection();
        return;
      }

      const node = hit.userData.node;
      const isDoubleClick = lastClick?.nodeId === node.id && now - lastClick.time <= DOUBLE_CLICK_WINDOW_MS;
      lastClick = { node, nodeId: node.id, time: now, x: event.clientX, y: event.clientY };

      if (isDoubleClick) {
        if (clickTimer !== null) window.clearTimeout(clickTimer);
        setHoverNode(null);
        onEnterNode(node);
        return;
      }

      if (clickTimer !== null) window.clearTimeout(clickTimer);
      pinNode(hit);
      setHoverNode(null);
      clickTimer = window.setTimeout(() => {
        setActiveNode({ node, x: event.clientX, y: event.clientY });
        clickTimer = null;
      }, DOUBLE_CLICK_WINDOW_MS);
    };

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      if (composer && bloomPass && bokehPass) {
        composer.setSize(mount.clientWidth, mount.clientHeight);
        bloomPass.setSize(mount.clientWidth, mount.clientHeight);
        bokehPass.setSize(mount.clientWidth, mount.clientHeight);
      }
    };

    const animate = () => {
      if (asleepRef.current || !visibleRef.current) {
        renderer.setAnimationLoop(null);
        running = false;
        return;
      }

      const now = performance.now();
      const targetSpeed = selectedRef.current ? 0 : 1;
      rotationSpeedRef.current = THREE.MathUtils.lerp(rotationSpeedRef.current, targetSpeed, targetSpeed ? 0.025 : 0.045);
      if (!dragging) {
        constellation.rotation.y += 0.00055 * rotationSpeedRef.current;
        constellation.rotation.x += Math.sin(now * 0.0001) * 0.00016 * rotationSpeedRef.current;
      }
      core.rotation.y -= 0.0006;
      dust.rotation.y -= 0.00008;
      dust.rotation.x = Math.sin(now * 0.00006) * 0.015;
      fineDust.rotation.y += 0.000035;
      fineDust.rotation.x = Math.sin(now * 0.000045) * 0.01;

      nodeMeshes.forEach((mesh, index) => {
        const pulse = 1 + Math.sin(now * 0.0015 + mesh.userData.pulse + index * 0.17) * 0.08;
        const currentTargetScale = mesh === pinnedMesh ? mesh.userData.baseScale * 1.5 : mesh.userData.targetScale;
        mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, currentTargetScale, 0.12));
        mesh.userData.ring.scale.setScalar((mesh === pinnedMesh ? 2.2 : pulse) * mesh.userData.baseScale);
        mesh.userData.ring.lookAt(camera.position);
        mesh.userData.labelAnchor.lookAt(camera.position);
      });

      filamentLines.forEach((line, index) => {
        const material = line.material as THREE.ShaderMaterial;
        const opacity = filamentBaseOpacities[index] * (0.86 + Math.sin(now * 0.00042 + index * 1.1) * 0.18);
        material.opacity = opacity;
        material.uniforms.opacity.value = opacity;
        material.uniforms.time.value = now * 0.001;
      });

      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };

    const wake = () => {
      if (!running && !asleepRef.current && visibleRef.current) {
        running = true;
        renderer.setAnimationLoop(animate);
      }
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', releaseHover);
    renderer.domElement.addEventListener('pointerleave', releaseHover);
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
      if (clickTimer !== null) window.clearTimeout(clickTimer);
      unsubscribe();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', releaseHover);
      renderer.domElement.removeEventListener('pointerleave', releaseHover);
      window.removeEventListener('resize', resize);

      if (composer) composer.dispose();
      renderer.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      nodeObjects.dispose();
      filamentLines.forEach((line) => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      dust.geometry.dispose();
      (dust.material as THREE.Material).dispose();
      fineDust.geometry.dispose();
      (fineDust.material as THREE.Material).dispose();
      mount.removeChild(renderer.domElement);
    };
  }, [asleepRef, mountRef, onEnterNode, rotationSpeedRef, selectedRef, setActiveNode, setHoverNode, setRenderError, starNodes, visibleRef]);
}
