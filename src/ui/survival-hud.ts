import { h, render } from 'preact';
import type { BaseSurvivalState } from '../systems/survival/BaseSurvivalSystem.ts';
import { COLONY_BALANCE } from '../systems/survival/economy.ts';

const units = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const rates = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const weatherLabels = {
  clear: 'Tempo limpo',
  'dust-storm': 'Tempestade de poeira',
  'electrical-storm': 'Tempestade elétrica',
};
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

function SurvivalHud({ state, onRepair }: { state: BaseSurvivalState; onRepair?: () => void }) {
  const { ore, integrity, impactCount, impactAlert, generation, demand, battery, batteryCapacity,
    miners, supportCapacity, miningRate, weather } = state;

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
    h('dl', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px', margin: '10px 0 0' },
    },
    h('div', null, h('dt', { style: labelStyle }, 'Geração / demanda'),
      h('dd', { style: { margin: 0 } }, `${rates.format(generation)} / ${rates.format(demand)} UJ/s`)),
    h('div', null, h('dt', { style: labelStyle }, 'Bateria'),
      h('dd', { style: { margin: 0 } }, `${rates.format(battery)} / ${batteryCapacity} UJ`)),
    h('div', null, h('dt', { style: labelStyle }, 'Mineração'),
      h('dd', { style: { margin: 0 } }, `${rates.format(miningRate)} UJ/s`)),
    h('div', null, h('dt', { style: labelStyle }, 'Suporte de vida'),
      h('dd', { style: { margin: 0 } }, `${miners} / ${supportCapacity} usinas`))),
    h('p', { style: { margin: '8px 0 0', color: weather === 'clear' ? '#d3bbb0' : '#ffb678', fontSize: '12px' } },
      weatherLabels[weather]),
    onRepair && integrity > 0 && integrity < 100
      ? h('button', {
        type: 'button',
        disabled: ore < COLONY_BALANCE.repairOrePerPoint,
        onClick: onRepair,
        style: {
          pointerEvents: 'auto', marginTop: '8px', padding: '5px 8px', borderRadius: '6px',
          border: '1px solid #8b5638', background: '#3f281c', color: '#f5ece6',
        },
      }, `Reparar · ${COLONY_BALANCE.repairOrePerPoint} UJ por ponto`)
      : null,
    h('div', { role: 'status' },
      integrity === 0 || impactAlert
        ? h('p', { key: impactCount, style: { ...iconRow, margin: '8px 0 0', color: '#ffb1a6', fontWeight: '600' } },
          hudIcon(impactIcon),
          integrity === 0 ? 'Base destruída' : 'Base atingida')
        : null,
    ),
  );
}

export function mountSurvivalHud(initialState: BaseSurvivalState, onRepair?: () => void) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let last: BaseSurvivalState | undefined;

  function update(state: BaseSurvivalState): void {
    const ore = Math.floor(state.ore + 1e-9);
    const battery = Math.round(state.battery * 10) / 10;
    if (last?.ore === ore && last.integrity === state.integrity
      && last.impactCount === state.impactCount && last.impactAlert === state.impactAlert
      && last.generation === state.generation && last.demand === state.demand
      && last.battery === battery && last.batteryCapacity === state.batteryCapacity
      && last.miners === state.miners && last.supportCapacity === state.supportCapacity
      && last.miningRate === state.miningRate && last.weather === state.weather) return;

    last = { ...state, ore, battery };
    render(h(SurvivalHud, { state: last, onRepair }), root);
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
