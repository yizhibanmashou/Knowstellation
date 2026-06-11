import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type WorkspacePanelState = 'open' | 'half' | 'collapsed';

interface WorkspacePanelProps {
  side: 'left' | 'right';
  label: string;
  state: WorkspacePanelState;
  onStateChange: (state: WorkspacePanelState) => void;
  children: ReactNode;
}

export function WorkspacePanel({ side, label, state, onStateChange, children }: WorkspacePanelProps) {
  const collapsed = state === 'collapsed' || state === 'half';
  const collapseLabel = `收起${label}面板`;
  const expandLabel = `展开${label}面板`;

  return (
    <aside className={`workspace-panel workspace-panel--${side} workspace-panel--${state}`}>
      {collapsed ? (
        <button type="button" className="workspace-panel__rail" onClick={() => onStateChange('open')} aria-label={expandLabel}>
          {label}
        </button>
      ) : (
        <>
          <button type="button" className="workspace-panel__collapse" onClick={() => onStateChange('collapsed')} aria-label={collapseLabel}>
            {side === 'left' ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
          {children}
        </>
      )}
    </aside>
  );
}
