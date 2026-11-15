import { h, render } from 'preact';
import type { BaseSurvivalState } from '../systems/survival/BaseSurvivalSystem.ts';

const units = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const oreIcon = new URL('./assets/lucide/gem.svg', import.meta.url).href;
const integrityIcon = new URL('./assets/lucide/shield.svg', import.meta.url).href;
const impactIcon = new URL('./assets/lucide/triangle-alert.svg', import.meta.url).href;
const iconRow = { display: 'flex', alignItems: 'center', gap: '6px' };
const labelStyle = { ...iconRow, color: '#d3bbb0', fontSize: '12px' };

function hudIcon(src: string) {
  return h('span', {
    'aria-hidden': 'true',
    style: {
      width: '14px',
      height: '14px',
      flexShrink: 0,
      backgroundColor: 'currentColor',
      mask: `url("${src}") center / contain no-repeat`,
    },
  });
}

function SurvivalHud({ ore, integrity, impactCount, impactAlert }: BaseSurvivalState) {
  return h(
    'section',
    {
      'aria-labelledby': 'survival-hud-title',
      style: {
        position: 'fixed',
        top: '16px',
        left: '16px',
        zIndex: 10,
        pointerEvents: 'none',
        boxSizing: 'border-box',
        width: 'min(300px, calc(100% - 32px))',
        padding: '12px 14px',
        border: '1px solid #633c28',
        borderRadius: '12px',
        background: '#20130e',
        color: '#f5ece6',
        font: '14px/1.35 system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
      },
    },
    h('h2', { id: 'survival-hud-title', style: { margin: '0 0 10px', fontSize: '14px' } }, 'Estado da base'),
    h(
      'dl',
      { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: 0 } },
      h('div', null,
        h('dt', { style: labelStyle }, hudIcon(oreIcon), 'Minério'),
        h('dd', { style: { margin: '2px 0 0', fontWeight: '600', fontVariantNumeric: 'tabular-nums' } },
          `${units.format(ore)} UJ`),
      ),
      h('div', null,
        h('dt', { style: labelStyle }, hudIcon(integrityIcon), 'Integridade'),
        h('dd', { style: { margin: '2px 0 0', fontWeight: '600', fontVariantNumeric: 'tabular-nums' } },
          `${integrity}%`),
      ),
    ),
    h('progress', {
      'aria-label': 'Integridade da base',
      max: 100,
      value: integrity,
      style: {
        display: 'block',
        width: '100%',
        height: '7px',
        marginTop: '8px',
        accentColor: integrity <= 25 ? '#ff8585' : '#7cdec0',
      },
    }),
    h('div', { role: 'status' },
      integrity === 0 || impactAlert
        ? h('p', { key: impactCount, style: { ...iconRow, margin: '8px 0 0', color: '#ffb1a6', fontWeight: '600' } },
          hudIcon(impactIcon),
          integrity === 0 ? 'Base destruída' : 'Impacto atingiu a base')
        : null,
    ),
  );
}

export function mountSurvivalHud(initialState: BaseSurvivalState) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let last: BaseSurvivalState | undefined;

  function update(state: BaseSurvivalState): void {
    const ore = Math.floor(state.ore + 1e-9);
    if (last?.ore === ore && last.integrity === state.integrity
      && last.impactCount === state.impactCount && last.impactAlert === state.impactAlert) return;

    last = { ...state, ore };
    render(h(SurvivalHud, last), root);
  }

  update(initialState);
  return {
    update,
    dispose(): void {
      render(null, root);
      root.remove();
    },
  };
}
