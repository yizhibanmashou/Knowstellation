import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStarFieldStore } from './starFieldStore';
import { StarNodeCard } from './StarNodeCard';
import { StarNodeHoverTooltip } from './StarNodeHoverTooltip';
import type { ActiveNode, StarFieldProps } from './starFieldTypes';
import { useStarFieldScene } from './useStarFieldScene';
import './StarField.css';

export function StarField({ nodes: starNodes, visible, onEnterNode, rightReserve = 0, rightReserveClassName }: StarFieldProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const asleep = useStarFieldStore((state) => state.asleep);
  const asleepRef = useRef(asleep);
  const visibleRef = useRef(visible);
  const selectedRef = useRef(false);
  const rotationSpeedRef = useRef(1);
  const [activeNode, setActiveNode] = useState<ActiveNode | null>(null);
  const [hoverNode, setHoverNode] = useState<ActiveNode | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    asleepRef.current = asleep;
  }, [asleep]);

  useEffect(() => {
    visibleRef.current = visible;
    if (!visible) setActiveNode(null);
    if (!visible) setHoverNode(null);
  }, [visible]);

  useEffect(() => {
    if (starNodes.length) return;
    setRenderError(null);
  }, [starNodes.length]);

  useStarFieldScene({
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
  });

  const card =
    activeNode && visible
      ? createPortal(
          <StarNodeCard
            node={activeNode.node}
            x={activeNode.x}
            y={activeNode.y}
            onClose={() => {
              selectedRef.current = false;
              setActiveNode(null);
            }}
            onEnter={() => onEnterNode(activeNode.node)}
          />,
          document.body,
        )
      : null;
  const hover =
    hoverNode && visible && !activeNode
      ? createPortal(<StarNodeHoverTooltip node={hoverNode.node} x={hoverNode.x} y={hoverNode.y} />, document.body)
      : null;

  return (
    <>
      <div
        ref={mountRef}
        className={`starfield-root ${rightReserve || rightReserveClassName ? 'starfield-root--reserved-right' : ''} ${rightReserveClassName || ''} ${visible ? 'starfield-root--visible' : 'starfield-root--hidden'}`}
        style={rightReserve ? ({ '--starfield-right-reserve': `${rightReserve}px` } as React.CSSProperties) : undefined}
        aria-hidden={!visible}
      >
        <div className="evolution-overlay" />
        {renderError ? <div className="starfield-error" role="status">{renderError}</div> : null}
      </div>
      {hover}
      {card}
    </>
  );
}

