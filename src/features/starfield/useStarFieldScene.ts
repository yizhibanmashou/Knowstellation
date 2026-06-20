import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { StarNode } from './starNavigation';
import { useStarFieldStore } from './starFieldStore';
import {
  CLICK_DRAG_THRESHOLD,
  DOUBLE_CLICK_MISS_THRESHOLD,
  DOUBLE_CLICK_WINDOW_MS,
  NODE_RADIUS,
  SINGLE_CLICK_CARD_DELAY_MS,
} from './starFieldConstants';
import { createBiologicalFilaments, createDust, fibonacciSphere } from './starFieldScene';
import { createStarNodeObjects, type StarNodeObjects } from './starFieldNodes';
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
  transitionKey?: string;
  visibleRef: MutableRefObject<boolean>;
}

interface StarNodeLayer {
  createdAt: number;
  filamentBaseOpacities: number[];
  filamentLines: THREE.Line[];
  nodeObjects: StarNodeObjects;
  opacity: number;
  state: 'entering' | 'active' | 'leaving';
}

interface StarFieldSceneHandle {
  clearInteraction: () => void;
  setNodes: (nodes: StarNode[], transitionKey: string) => void;
  wake: () => void;
}

const NODE_LAYER_FADE_MS = 360;
const NODE_LAYER_SETTLE_MS = 520;
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function isMobileViewport(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
}

function nodeSignature(nodes: StarNode[]): string {
  return nodes.map((node) => `${node.id}:${node.kind}:${node.displayLabel || node.label}`).join('|');
}

function smoothStep(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function dampingFactor(lambda: number, deltaSeconds: number): number {
  return 1 - Math.exp(-lambda * deltaSeconds);
}

function disposeLine(line: THREE.Line) {
  line.geometry.dispose();
  (line.material as THREE.Material).dispose();
}

function setLineOpacity(line: THREE.Line, opacity: number, baseOpacity: number, time: number) {
  const material = line.material as THREE.ShaderMaterial;
  const nextOpacity = baseOpacity * opacity;
  material.opacity = nextOpacity;
  material.uniforms.opacity.value = nextOpacity;
  material.uniforms.time.value = time;
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
  transitionKey,
  visibleRef,
}: UseStarFieldSceneParams) {
  const sceneHandleRef = useRef<StarFieldSceneHandle | null>(null);
  const onEnterNodeRef = useRef(onEnterNode);
  const setActiveNodeRef = useRef(setActiveNode);
  const setHoverNodeRef = useRef(setHoverNode);
  const nodeUpdateRef = useRef({ signature: '', transitionKey: '' });

  useEffect(() => {
    onEnterNodeRef.current = onEnterNode;
  }, [onEnterNode]);

  useEffect(() => {
    setActiveNodeRef.current = setActiveNode;
  }, [setActiveNode]);

  useEffect(() => {
    setHoverNodeRef.current = setHoverNode;
  }, [setHoverNode]);

  useEffect(() => {
    const handle = sceneHandleRef.current;
    if (!handle) return;
    const signature = nodeSignature(starNodes);
    const nextTransitionKey = transitionKey || signature;
    const previous = nodeUpdateRef.current;
    if (previous.signature === signature && previous.transitionKey === nextTransitionKey) return;
    nodeUpdateRef.current = { signature, transitionKey: nextTransitionKey };
    handle.setNodes(starNodes, nextTransitionKey);
    handle.wake();
  }, [starNodes, transitionKey]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setRenderError(null);

    const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const isMobile = isMobileViewport();
    const reducedMotion = () => reducedMotionQuery.matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x030611, 0.085);

    const camera = new THREE.PerspectiveCamera(42, Math.max(1, mount.clientWidth) / Math.max(1, mount.clientHeight), 0.1, 80);
    camera.position.set(0, 0.18, 8.6);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: true, powerPreference: 'high-performance' });
    } catch (error) {
      console.error('Knowstellation star map WebGL initialization failed', error);
      setRenderError('星图 3D 渲染暂不可用，已切换为静态星空背景。');
      return;
    }

    renderer.setClearColor(0x030611, 0);
    const targetPixelRatio = isMobile ? Math.min(window.devicePixelRatio, 1.05) : Math.min(window.devicePixelRatio, 1.35);
    renderer.setPixelRatio(targetPixelRatio);
    renderer.setSize(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.38;
    mount.appendChild(renderer.domElement);

    let composer: EffectComposer | null = null;
    let bloomPass: UnrealBloomPass | null = null;

    if (!isMobile) {
      composer = new EffectComposer(renderer);
      const renderPass = new RenderPass(scene, camera);
      bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, mount.clientWidth), Math.max(1, mount.clientHeight)), 0.95, 0.36, 0.2);
      composer.addPass(renderPass);
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

    const coreGeometry = new THREE.SphereGeometry(2.1, isMobile ? 40 : 56, isMobile ? 40 : 56);
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

    const dust = createDust(isMobile ? 1500 : 2400, 0.018, 0.46, 5, 18, -4);
    const fineDust = createDust(isMobile ? 760 : 1500, 0.009, 0.32, 7, 24, -7);
    scene.add(dust, fineDust);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Mesh.threshold = 0.02;
    const pointer = new THREE.Vector2();
    const lastPointer = { x: 0, y: 0 };
    const dragStart = { x: 0, y: 0 };
    const dragVelocity = { x: 0, y: 0 };
    const layers: StarNodeLayer[] = [];
    let activeLayer: StarNodeLayer | null = null;
    let activeSignature = '';
    let activeTransitionKey = '';
    let pressed = false;
    let dragging = false;
    let hoveredMesh: NodeMesh | null = null;
    let pinnedMesh: NodeMesh | null = null;
    let clickTimer: number | null = null;
    let lastClick: { node: StarNode; nodeId: string; time: number; x: number; y: number } | null = null;
    let running = false;
    let hoverFrame: number | null = null;
    let latestHoverEvent: PointerEvent | null = null;
    let lastHoverNodeId: string | null = null;
    let lastHoverX = 0;
    let lastHoverY = 0;
    let lastPick: { mesh: NodeMesh; time: number; x: number; y: number } | null = null;
    let lastCursor = 'grab';
    let lastFrameTime = performance.now();

    const getPickTargets = () => activeLayer?.nodeObjects.hitTargets.filter((target) => target.visible) || [];

    const clearSelection = () => {
      if (pinnedMesh) pinnedMesh.userData.targetScale = pinnedMesh.userData.baseScale;
      pinnedMesh = null;
      selectedRef.current = false;
      setActiveNodeRef.current(null);
    };

    const updateCursor = (cursor: string) => {
      if (lastCursor === cursor) return;
      lastCursor = cursor;
      renderer.domElement.style.cursor = cursor;
    };

    const releaseHover = () => {
      if (hoveredMesh && hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale;
      hoveredMesh = null;
      lastHoverNodeId = null;
      latestHoverEvent = null;
      if (hoverFrame !== null) {
        window.cancelAnimationFrame(hoverFrame);
        hoverFrame = null;
      }
      updateCursor('grab');
      setHoverNodeRef.current(null);
    };

    const clearInteraction = () => {
      releaseHover();
      clearSelection();
      pressed = false;
      dragging = false;
      lastClick = null;
      if (clickTimer !== null) {
        window.clearTimeout(clickTimer);
        clickTimer = null;
      }
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
      const hit = raycaster.intersectObjects(getPickTargets(), false)[0]?.object as HitTargetMesh | undefined;
      return hit?.userData.node;
    };

    const setHoverFromEvent = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current || dragging) return;
      const hit = pickNode(event) || hoveredMesh;
      if (hoveredMesh && hoveredMesh !== hit && hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale;
      hoveredMesh = hit || null;
      updateCursor(hoveredMesh ? 'pointer' : 'grab');
      if (hoveredMesh) {
        lastPick = { mesh: hoveredMesh, time: performance.now(), x: event.clientX, y: event.clientY };
        dragVelocity.x *= 0.22;
        dragVelocity.y *= 0.22;
        if (hoveredMesh !== pinnedMesh) hoveredMesh.userData.targetScale = hoveredMesh.userData.baseScale * 1.35;
        const nodeId = hoveredMesh.userData.node.id;
        const movedEnough = Math.hypot(event.clientX - lastHoverX, event.clientY - lastHoverY) > 14;
        if (nodeId !== lastHoverNodeId || movedEnough) {
          lastHoverNodeId = nodeId;
          lastHoverX = event.clientX;
          lastHoverY = event.clientY;
          setHoverNodeRef.current({ node: hoveredMesh.userData.node, x: event.clientX, y: event.clientY });
        }
      } else if (lastHoverNodeId !== null) {
        lastHoverNodeId = null;
        setHoverNodeRef.current(null);
      }
    };

    const scheduleHover = (event: PointerEvent) => {
      latestHoverEvent = event;
      if (hoverFrame !== null) return;
      hoverFrame = window.requestAnimationFrame(() => {
        hoverFrame = null;
        if (latestHoverEvent) setHoverFromEvent(latestHoverEvent);
      });
    };

    const pointerDown = (event: PointerEvent) => {
      if (asleepRef.current || !visibleRef.current) return;
      pressed = true;
      dragging = false;
      dragVelocity.x = 0;
      dragVelocity.y = 0;
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
          const moveX = event.clientX - lastPointer.x;
          const moveY = event.clientY - lastPointer.y;
          constellation.rotation.y += moveX * 0.0032;
          constellation.rotation.x += moveY * 0.0024;
          constellation.rotation.x = THREE.MathUtils.clamp(constellation.rotation.x, -0.62, 0.62);
          dragVelocity.x = THREE.MathUtils.lerp(dragVelocity.x, moveY * 0.0024, 0.42);
          dragVelocity.y = THREE.MathUtils.lerp(dragVelocity.y, moveX * 0.0032, 0.42);
          releaseHover();
          updateCursor('grabbing');
          lastPointer.x = event.clientX;
          lastPointer.y = event.clientY;
          return;
        }
      }
      scheduleHover(event);
    };

    const pointerUp = (event: PointerEvent) => {
      if (!pressed || asleepRef.current || !visibleRef.current) return;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      pressed = false;
      updateCursor('grab');
      if (dragging) {
        dragging = false;
        return;
      }

      const recentPick =
        lastPick &&
        window.performance.now() - lastPick.time < 1200 &&
        Math.hypot(event.clientX - lastPick.x, event.clientY - lastPick.y) < 24
          ? lastPick.mesh
          : null;
      const hit = pickNode(event) || hoveredMesh || recentPick;
      const now = window.performance.now();
      if (!hit) {
        const previousClick = lastClick;
        const isMissedSecondClick =
          previousClick &&
          now - previousClick.time <= DOUBLE_CLICK_WINDOW_MS &&
          Math.hypot(event.clientX - previousClick.x, event.clientY - previousClick.y) <= DOUBLE_CLICK_MISS_THRESHOLD;
        if (isMissedSecondClick) {
          if (clickTimer !== null) window.clearTimeout(clickTimer);
          onEnterNodeRef.current(previousClick.node);
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
        setHoverNodeRef.current(null);
        onEnterNodeRef.current(node);
        return;
      }

      if (clickTimer !== null) window.clearTimeout(clickTimer);
      pinNode(hit);
      setHoverNodeRef.current(null);
      clickTimer = window.setTimeout(() => {
        setActiveNodeRef.current({ node, x: event.clientX, y: event.clientY });
        clickTimer = null;
      }, SINGLE_CLICK_CARD_DELAY_MS);
    };

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      if (composer && bloomPass) {
        composer.setSize(mount.clientWidth, mount.clientHeight);
        bloomPass.setSize(mount.clientWidth, mount.clientHeight);
      }
    };

    const removeLayer = (layer: StarNodeLayer) => {
      const index = layers.indexOf(layer);
      if (index >= 0) layers.splice(index, 1);
      layer.nodeObjects.dispose();
      layer.filamentLines.forEach((line) => {
        constellation.remove(line);
        disposeLine(line);
      });
      if (activeLayer === layer) activeLayer = null;
    };

    const createLayer = (nodes: StarNode[]): StarNodeLayer | null => {
      if (!nodes.length) return null;
      const nodePoints = fibonacciSphere(nodes.length, NODE_RADIUS);
      const nodeObjects = createStarNodeObjects(constellation, nodes, nodePoints);
      const filamentLines = createBiologicalFilaments(nodePoints, nodes);
      const filamentBaseOpacities = filamentLines.map((line) => Number(line.userData.baseOpacity || 0.07));
      filamentLines.forEach((line) => constellation.add(line));
      const layer: StarNodeLayer = {
        createdAt: performance.now(),
        filamentBaseOpacities,
        filamentLines,
        nodeObjects,
        opacity: reducedMotion() ? 1 : 0,
        state: reducedMotion() ? 'active' : 'entering',
      };
      nodeObjects.setOpacity(layer.opacity);
      filamentLines.forEach((line, index) => setLineOpacity(line, layer.opacity, filamentBaseOpacities[index], 0));
      layers.push(layer);
      return layer;
    };

    const setNodes = (nodes: StarNode[], nextTransitionKey: string) => {
      const signature = nodeSignature(nodes);
      if (signature === activeSignature && nextTransitionKey === activeTransitionKey) return;
      activeSignature = signature;
      activeTransitionKey = nextTransitionKey;
      clearInteraction();

      layers.forEach((layer) => {
        layer.state = 'leaving';
        layer.createdAt = performance.now();
      });

      const nextLayer = createLayer(nodes);
      activeLayer = nextLayer;
      if (!nextLayer) {
        layers.slice().forEach(removeLayer);
      }
    };

    const animateLayer = (layer: StarNodeLayer, now: number, deltaSeconds: number) => {
      const fadeDuration = reducedMotion() ? 1 : NODE_LAYER_FADE_MS;
      if (layer.state === 'entering') {
        layer.opacity = smoothStep((now - layer.createdAt) / fadeDuration);
        if (layer.opacity >= 0.998 || now - layer.createdAt > NODE_LAYER_SETTLE_MS) {
          layer.opacity = 1;
          layer.state = 'active';
        }
      } else if (layer.state === 'leaving') {
        layer.opacity = 1 - smoothStep((now - layer.createdAt) / fadeDuration);
        if (layer.opacity <= 0.002 || now - layer.createdAt > NODE_LAYER_SETTLE_MS) {
          removeLayer(layer);
          return;
        }
      }

      layer.nodeObjects.setOpacity(layer.opacity);
      layer.nodeObjects.nodeMeshes.forEach((mesh, index) => {
        const pulse = 1 + Math.sin(now * 0.0015 + mesh.userData.pulse + index * 0.17) * 0.08;
        const currentTargetScale = mesh === pinnedMesh ? mesh.userData.baseScale * 1.5 : mesh.userData.targetScale;
        mesh.scale.setScalar(THREE.MathUtils.lerp(mesh.scale.x, currentTargetScale, dampingFactor(13, deltaSeconds)));
        mesh.userData.ring.scale.setScalar((mesh === pinnedMesh ? 2.2 : pulse) * mesh.userData.baseScale);
        mesh.userData.ring.lookAt(camera.position);
        mesh.userData.labelAnchor.lookAt(camera.position);
      });

      layer.filamentLines.forEach((line, index) => {
        const opacityPulse = layer.filamentBaseOpacities[index] * (0.86 + Math.sin(now * 0.00042 + index * 1.1) * 0.18);
        setLineOpacity(line, layer.opacity, opacityPulse, now * 0.001);
      });
    };

    const animate = () => {
      if (asleepRef.current || !visibleRef.current) {
        renderer.setAnimationLoop(null);
        running = false;
        return;
      }

      const now = performance.now();
      const deltaSeconds = Math.min(0.04, Math.max(0.001, (now - lastFrameTime) / 1000));
      lastFrameTime = now;
      const targetSpeed = selectedRef.current ? 0 : 1;
      rotationSpeedRef.current = THREE.MathUtils.lerp(rotationSpeedRef.current, targetSpeed, dampingFactor(targetSpeed ? 1.7 : 3.2, deltaSeconds));

      if (!dragging) {
        if (!reducedMotion()) {
          constellation.rotation.y += dragVelocity.y;
          constellation.rotation.x += dragVelocity.x;
          constellation.rotation.x = THREE.MathUtils.clamp(constellation.rotation.x, -0.62, 0.62);
          dragVelocity.x *= Math.exp(-5.8 * deltaSeconds);
          dragVelocity.y *= Math.exp(-5.8 * deltaSeconds);
        }
        constellation.rotation.y += 0.00055 * rotationSpeedRef.current;
        constellation.rotation.x += Math.sin(now * 0.0001) * 0.00016 * rotationSpeedRef.current;
      }

      core.rotation.y -= 0.0006;
      dust.rotation.y -= 0.00008;
      dust.rotation.x = Math.sin(now * 0.00006) * 0.015;
      fineDust.rotation.y += 0.000035;
      fineDust.rotation.x = Math.sin(now * 0.000045) * 0.01;

      layers.slice().forEach((layer) => animateLayer(layer, now, deltaSeconds));

      if (composer) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    };

    const wake = () => {
      if (!running && !asleepRef.current && visibleRef.current) {
        running = true;
        lastFrameTime = performance.now();
        renderer.setAnimationLoop(animate);
      }
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', releaseHover);
    renderer.domElement.addEventListener('pointerleave', releaseHover);
    window.addEventListener('resize', resize);

    sceneHandleRef.current = { clearInteraction, setNodes, wake };
    const initialSignature = nodeSignature(starNodes);
    const initialTransitionKey = transitionKey || initialSignature;
    nodeUpdateRef.current = { signature: initialSignature, transitionKey: initialTransitionKey };
    setNodes(starNodes, initialTransitionKey);
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
      sceneHandleRef.current = null;
      window.clearInterval(visibilityTimer);
      if (clickTimer !== null) window.clearTimeout(clickTimer);
      if (hoverFrame !== null) window.cancelAnimationFrame(hoverFrame);
      unsubscribe();
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', releaseHover);
      renderer.domElement.removeEventListener('pointerleave', releaseHover);
      window.removeEventListener('resize', resize);

      if (composer) composer.dispose();
      layers.slice().forEach(removeLayer);
      renderer.dispose();
      coreGeometry.dispose();
      coreMaterial.dispose();
      dust.geometry.dispose();
      (dust.material as THREE.Material).dispose();
      fineDust.geometry.dispose();
      (fineDust.material as THREE.Material).dispose();
      if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
    };
  }, [asleepRef, mountRef, rotationSpeedRef, selectedRef, setRenderError, visibleRef]);
}
