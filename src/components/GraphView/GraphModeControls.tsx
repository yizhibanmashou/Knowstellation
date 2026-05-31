import { DEFAULT_LANGUAGE, getUiCopy } from '../../utils/uiCopy';

export type GraphStudyMode = 'guided' | 'explore';

interface GraphModeControlsProps {
  mode: GraphStudyMode;
  onModeChange: (mode: GraphStudyMode) => void;
  lockedMode?: GraphStudyMode;
}

const MODES: GraphStudyMode[] = ['guided', 'explore'];

export function GraphModeControls({ mode, onModeChange, lockedMode }: GraphModeControlsProps) {
  const copy = getUiCopy(DEFAULT_LANGUAGE).graph;

  return (
    <div className="graph-mode-controls" aria-label="图谱学习模式">
      {MODES.map((item) => {
        const modeCopy = copy.modes[item];
        const disabled = Boolean(lockedMode && item !== lockedMode);
        return (
          <button
            key={item}
            type="button"
            disabled={disabled}
            onClick={() => onModeChange(item)}
            className={item === mode ? 'graph-mode-controls__button graph-mode-controls__button--active' : 'graph-mode-controls__button'}
            title={disabled ? copy.modes.locked : modeCopy.description}
          >
            {modeCopy.label}
          </button>
        );
      })}
    </div>
  );
}
