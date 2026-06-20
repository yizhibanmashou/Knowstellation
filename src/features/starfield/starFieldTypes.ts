import type * as THREE from 'three';
import type { StarNode } from './starNavigation';

export interface StarFieldProps {
  nodes: StarNode[];
  visible: boolean;
  onEnterNode: (node: StarNode) => void;
  rightReserve?: number;
  rightReserveClassName?: string;
  transitionKey?: string;
}

export interface NodeMesh extends THREE.Mesh {
  userData: {
    node: StarNode;
    baseScale: number;
    targetScale: number;
    nodeOpacity: number;
    ringOpacity: number;
    labelOpacity: number;
    pulse: number;
    ring: THREE.Mesh;
    label: THREE.Sprite;
    labelAnchor: THREE.Object3D;
    hitTarget: THREE.Mesh;
  };
}

export interface HitTargetMesh extends THREE.Mesh {
  userData: {
    node: NodeMesh;
  };
}

export type ActiveNode = {
  node: StarNode;
  x: number;
  y: number;
};
