import * as THREE from 'three';
import type { StarNode } from '../../utils/starNavigation';
import { NODE_HIT_RADIUS, NODE_VISUAL_RADIUS } from './starFieldConstants';
import { makeLabelSprite } from './starFieldScene';
import type { HitTargetMesh, NodeMesh } from './starFieldTypes';

interface StarNodeObjects {
  hitTargets: HitTargetMesh[];
  nodeMeshes: NodeMesh[];
  dispose: () => void;
}

export function createStarNodeObjects(constellation: THREE.Group, starNodes: StarNode[], nodePoints: THREE.Vector3[]): StarNodeObjects {
  const nodeGeometry = new THREE.SphereGeometry(NODE_VISUAL_RADIUS, 32, 32);
  const haloGeometry = new THREE.SphereGeometry(0.09, 24, 24);
  const hitGeometry = new THREE.SphereGeometry(NODE_HIT_RADIUS, 16, 16);
  const hitMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
  const nodeMeshes: NodeMesh[] = [];
  const hitTargets: HitTargetMesh[] = [];

  starNodes.forEach((node, index) => {
    const isAppendix = /^appendix/i.test(node.chapterId || node.id);
    const color = node.isBackbone
      ? new THREE.Color(0xc7e7ff)
      : node.kind === 'chapter'
        ? new THREE.Color(isAppendix ? 0xd4c5b9 : 0xffffff)
        : new THREE.Color(0xdbeafe);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: node.isBackbone ? 0.48 : 0.4,
      roughness: 0.34,
      metalness: 0,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(nodeGeometry, material) as unknown as NodeMesh;
    mesh.position.copy(nodePoints[index]);
    const baseScale = node.isBackbone ? 1.16 : node.kind === 'chapter' ? 1.45 : 1;
    mesh.scale.setScalar(baseScale);

    const ring = new THREE.Mesh(
      haloGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: node.isBackbone ? 0.16 : 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    ring.position.copy(mesh.position);

    const labelFontSize = node.kind === 'chapter' ? 30 : 24;
    const label = makeLabelSprite(node.displayLabel || node.label, labelFontSize);
    const labelAnchor = new THREE.Object3D();
    labelAnchor.position.copy(mesh.position);
    label.position.set(0, 0, NODE_VISUAL_RADIUS * baseScale + 0.004);
    label.scale.setScalar(node.kind === 'chapter' ? 0.16 : 0.13);
    labelAnchor.add(label);

    const hitTarget = new THREE.Mesh(hitGeometry, hitMaterial) as unknown as HitTargetMesh;
    hitTarget.position.copy(mesh.position);
    hitTarget.userData = { node: mesh };

    mesh.userData = {
      node,
      baseScale,
      targetScale: baseScale,
      pulse: 0.75 + Math.random() * 1.4,
      ring,
      label,
      labelAnchor,
      hitTarget,
    };
    nodeMeshes.push(mesh);
    hitTargets.push(hitTarget);
    constellation.add(ring, mesh, labelAnchor, hitTarget);
  });

  return {
    hitTargets,
    nodeMeshes,
    dispose: () => {
      nodeGeometry.dispose();
      haloGeometry.dispose();
      hitGeometry.dispose();
      hitMaterial.dispose();
      nodeMeshes.forEach((mesh) => {
        (mesh.material as THREE.Material).dispose();
        (mesh.userData.ring.material as THREE.Material).dispose();
        const labelMaterial = mesh.userData.label.material as THREE.SpriteMaterial;
        if (labelMaterial.map) {
          labelMaterial.map.dispose();
        }
        labelMaterial.dispose();
      });
    },
  };
}
