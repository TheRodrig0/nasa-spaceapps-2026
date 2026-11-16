import { h, render } from 'preact';
import type { BaseSurvivalState } from '../systems/survival/BaseSurvivalSystem.ts';
import { LOADOUT_CONFIGS } from '../systems/survival/loadouts.ts';
import type { SolarPhase } from '../types/index.ts';
import { COLONY_BALANCE } from '../systems/survival/economy.ts';

export type LoadoutId = 'standard' | 'hull' | 'battery';
export type DifficultyId = 'calm' | 'normal' | 'intense';

export interface GameSettings {
  cameraSpeed: 'slow' | 'normal' | 'fast';
  resolutionScale: 'performance' | 'native';
  solDurationSec: 36 | 48 | 72;
}

export interface SurvivalHudMeta {
  loadout: LoadoutId;
  difficulty: DifficultyId;
  settings: GameSettings;
  settingsOpen: boolean;
}

export interface SurvivalHudActions {
  onRepair: () => void;
  onStartMission: () => void;
  onPause: () => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onToggleSettings: (open: boolean) => void;
  onUpdateSettings: (next: GameSettings) => void;
  onSelectLoadout: (loadout: LoadoutId) => void;
  onSelectDifficulty: (difficulty: DifficultyId) => void;
}

const units = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const rates = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const weatherLabels = {
  clear: 'Tempo limpo',
  'dust-storm': 'Tempestade de poeira',
  'electrical-storm': 'Tempestade elétrica',
};
const phaseLabels: Record<SolarPhase, string> = {
  dawn: 'Amanhecer',
  day: 'Dia',
  dusk: 'Entardecer',
  night: 'Noite',
};
const phaseColors: Record<SolarPhase, string> = {
  dawn: '#ffb36b',
  day: '#ffd97d',
  dusk: '#ff8a4c',
  night: '#8faeff',
};
const oreIcon = new URL('./assets/lucide/gem.svg', import.meta.url).href;
const integrityIcon = new URL('./assets/lucide/shield.svg', import.meta.url).href;
const impactIcon = new URL('./assets/lucide/triangle-alert.svg', import.meta.url).href;
const iconRow = { display: 'flex', alignItems: 'center', gap: '6px' };
const labelStyle = { ...iconRow, color: '#d3bbb0', fontSize: '12px' };

const btnStyle = (active = false) => ({
  pointerEvents: 'auto' as const,
  padding: '7px 10px',
  borderRadius: '7px',
  border: active ? '1px solid #e6a368' : '1px solid #72472e',
  background: active ? '#573018' : '#2c1a13',
  color: active ? '#ffe0ba' : '#f5ece6',
  fontWeight: active ? '600' : '500',
  fontSize: '12.5px',
  cursor: 'pointer',
});

const primaryBtnStyle = {
  pointerEvents: 'auto' as const,
  padding: '9px 14px',
  borderRadius: '8px',
  border: '1px solid #c97b4b',
  background: '#8f4722',
  color: '#fff6f0',
  fontWeight: '600',
  fontSize: '13.5px',
  cursor: 'pointer',
};

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

function SurvivalHud({
  state,
  meta,
  actions,
}: {
  state: BaseSurvivalState;
  meta: SurvivalHudMeta;
  actions: SurvivalHudActions;
}) {
  const {
    ore,
    oreCapacity,
    integrity,
    impactCount,
    impactAlert,
    generation,
    demand,
    battery,
    batteryCapacity,
    miners,
    supportCapacity,
    miningRate,
    weather,
    stage,
    stageTitle,
    stageGoal,
    sol,
    activeEvent,
    status = 'playing',
    endReason,
  } = state;

  const isMenu = status === 'menu';
  const isPaused = status === 'paused';
  const showEndModal = status === 'victory' || status === 'defeat';

  const loadouts: ReadonlyArray<{ id: LoadoutId; label: string; desc: string }> = [
    { id: 'standard', label: 'Padrão', desc: `${LOADOUT_CONFIGS.standard.startingOre} UJ de minério` },
    { id: 'hull', label: 'Casco Reforçado', desc: `${LOADOUT_CONFIGS.hull.startingOre} UJ · −25% de dano` },
    { id: 'battery', label: 'Reserva Elétrica', desc: `${LOADOUT_CONFIGS.battery.startingOre} UJ · +${LOADOUT_CONFIGS.battery.initialBattery} de bateria` },
  ];

  const difficulties: ReadonlyArray<{ id: DifficultyId; label: string; desc: string }> = [
    { id: 'calm', label: 'Calmo', desc: 'Eventos raros' },
    { id: 'normal', label: 'Normal', desc: 'Padrão' },
    { id: 'intense', label: 'Intenso', desc: 'Eventos frequentes' },
  ];

  return h(
    'div',
    null,
    !isMenu
      ? h(
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
              width: 'min(316px, calc(100% - 32px))',
              padding: '12px 14px',
              border: '1px solid #633c28',
              borderRadius: '12px',
              background: '#20130e',
              color: '#f5ece6',
              font: '14px/1.35 system-ui, sans-serif',
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
            },
          },
          h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '8px',
              },
            },
            sol
              ? h(
                  'span',
                  {
                    id: 'survival-hud-title',
                    style: {
                      fontSize: '12.5px',
                      fontWeight: '700',
                      fontVariantNumeric: 'tabular-nums',
                      color: phaseColors[sol.phase],
                    },
                  },
                  `Sol ${sol.solIndex}/${sol.targetSols} · ${phaseLabels[sol.phase]}`,
                )
              : h('h2', { id: 'survival-hud-title', style: { margin: 0, fontSize: '14px' } }, 'Estado da base'),
            status === 'playing'
              ? h(
                  'div',
                  { style: { display: 'flex', gap: '4px', pointerEvents: 'auto' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: () => actions.onToggleSettings(true),
                      style: {
                        padding: '2px 7px',
                        borderRadius: '5px',
                        border: '1px solid #72472e',
                        background: '#2c1a13',
                        color: '#e6d8cf',
                        fontSize: '11px',
                        cursor: 'pointer',
                      },
                    },
                    'Config',
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      onClick: actions.onPause,
                      style: {
                        padding: '2px 7px',
                        borderRadius: '5px',
                        border: '1px solid #72472e',
                        background: '#2c1a13',
                        color: '#e6d8cf',
                        fontSize: '11px',
                        cursor: 'pointer',
                      },
                    },
                    'Pausar',
                  ),
                )
              : null,
          ),
          sol
            ? h('progress', {
                'aria-label': 'Progresso do ciclo solar',
                max: 100,
                value: Math.round(sol.solProgress * 100),
                style: {
                  display: 'block',
                  width: '100%',
                  height: '4px',
                  marginBottom: '8px',
                  accentColor: phaseColors[sol.phase],
                },
              })
            : null,
          h(
            'div',
            {
              style: {
                marginBottom: '10px',
                paddingBottom: '8px',
                borderBottom: '1px solid #4d2f20',
              },
            },
            h(
              'div',
              { style: { fontSize: '12px', fontWeight: '600', color: '#ffb078' } },
              `Etapa ${stage}/5 · ${stageTitle}`,
            ),
            h(
              'div',
              { style: { fontSize: '11.5px', color: '#d3bbb0', marginTop: '2px' } },
              stageGoal,
            ),
          ),
          h(
            'dl',
            { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', margin: 0 } },
            h(
              'div',
              null,
              h('dt', { style: labelStyle }, hudIcon(oreIcon), 'Minério'),
              h(
                'dd',
                { style: { margin: '2px 0 0', fontWeight: '600', fontVariantNumeric: 'tabular-nums' } },
                `${units.format(ore)} / ${oreCapacity} UJ`,
              ),
            ),
            h(
              'div',
              null,
              h('dt', { style: labelStyle }, hudIcon(integrityIcon), 'Integridade'),
              h(
                'dd',
                { style: { margin: '2px 0 0', fontWeight: '600', fontVariantNumeric: 'tabular-nums' } },
                `${integrity}%`,
              ),
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
          h(
            'dl',
            {
              style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px 12px', margin: '10px 0 0' },
            },
            h(
              'div',
              null,
              h('dt', { style: labelStyle }, 'Geração / demanda'),
              h('dd', { style: { margin: 0 } }, `${rates.format(generation)} / ${rates.format(demand)} UJ/s`),
            ),
            h(
              'div',
              null,
              h('dt', { style: labelStyle }, 'Bateria'),
              h('dd', { style: { margin: 0 } }, `${rates.format(battery)} / ${batteryCapacity} UJ`),
            ),
            h(
              'div',
              null,
              h('dt', { style: labelStyle }, 'Mineração'),
              h('dd', { style: { margin: 0 } }, `${rates.format(miningRate)} UJ/s`),
            ),
            h(
              'div',
              null,
              h('dt', { style: labelStyle }, 'Suporte de vida'),
              h('dd', { style: { margin: 0 } }, `${miners} / ${supportCapacity} usinas`),
            ),
          ),
          h(
            'p',
            { style: { margin: '8px 0 0', color: weather === 'clear' ? '#d3bbb0' : '#ffb678', fontSize: '12px' } },
            weatherLabels[weather],
          ),
          status === 'playing' && integrity > 0 && integrity < 100
            ? h(
                'button',
                {
                  type: 'button',
                  disabled: ore < COLONY_BALANCE.repairOrePerPoint,
                  onClick: actions.onRepair,
                  style: {
                    pointerEvents: 'auto',
                    marginTop: '8px',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    border: '1px solid #8b5638',
                    background: '#3f281c',
                    color: '#f5ece6',
                    cursor: ore < COLONY_BALANCE.repairOrePerPoint ? 'not-allowed' : 'pointer',
                  },
                },
                `Reparar · ${COLONY_BALANCE.repairOrePerPoint} UJ por ponto`,
              )
            : null,
          h(
            'div',
            { role: 'status' },
            integrity === 0 || impactAlert
              ? h(
                  'p',
                  { key: impactCount, style: { ...iconRow, margin: '8px 0 0', color: '#ffb1a6', fontWeight: '600' } },
                  hudIcon(impactIcon),
                  integrity === 0 ? 'Base destruída' : 'Base atingida',
                )
              : activeEvent
                ? h(
                    'p',
                    {
                      key: `${activeEvent.type}-${activeEvent.phase}`,
                      style: {
                        ...iconRow,
                        margin: '8px 0 0',
                        color: activeEvent.phase === 'warning' ? '#ffcc66' : '#ff9988',
                        fontWeight: '600',
                      },
                    },
                    hudIcon(impactIcon),
                    `${activeEvent.phase === 'warning' ? 'Alerta' : 'Perigo'}: ${activeEvent.label} (${Math.ceil(activeEvent.remainingSec)}s)`,
                  )
                : null,
          ),
        )
      : null,

    isMenu && !meta.settingsOpen
      ? h(
          'div',
          {
            role: 'dialog',
            'aria-modal': 'true',
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 25,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(12, 8, 6, 0.45)',
              pointerEvents: 'auto',
              font: '14px/1.45 system-ui, sans-serif',
            },
          },
          h(
            'div',
            {
              style: {
                width: 'min(420px, calc(100% - 32px))',
                padding: '22px',
                borderRadius: '14px',
                border: '1px solid #633c28',
                background: 'rgba(32, 19, 14, 0.94)',
                color: '#f5ece6',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              },
            },
            h('h1', { style: { margin: '0 0 4px', fontSize: '20px', color: '#fff3e6' } }, 'Missão Marte · Posto Aurora'),
            h(
              'p',
              { style: { margin: '0 0 8px', fontSize: '13px', color: '#d3bbb0' } },
              'Uma chuva de meteoros interrompeu a pesquisa de tremores marcianos em um setor inspirado em Cerberus Fossae. A próxima equipe chega em 10 sóis pra retomar a investigação.',
            ),
            h(
              'p',
              { style: { margin: '0 0 16px', fontSize: '13px', color: '#fff3e6' } },
              'Conclua as cinco etapas e mantenha o Posto Aurora de pé até o revezamento.',
            ),
            h(
              'a',
              {
                href: 'https://www.jpl.nasa.gov/news/nasas-insight-reveals-the-deep-interior-of-mars/',
                target: '_blank',
                rel: 'noreferrer',
                style: { display: 'inline-block', margin: '0 0 14px', color: '#ffb078', fontSize: '12px' },
              },
              'Inspiração científica · InSight da NASA',
            ),
            h('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '6px' } }, 'Perfil inicial'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '14px' } },
              loadouts.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    'aria-pressed': meta.loadout === item.id,
                    onClick: () => actions.onSelectLoadout(item.id),
                    style: { ...btnStyle(meta.loadout === item.id), textAlign: 'left', padding: '8px' },
                  },
                  h('div', { style: { fontWeight: '600', fontSize: '12px' } }, item.label),
                  h('div', { style: { fontSize: '11px', color: '#d3bbb0', marginTop: '2px' } }, item.desc),
                ),
              ),
            ),
            h('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '6px' } }, 'Dificuldade'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '18px' } },
              difficulties.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    'aria-pressed': meta.difficulty === item.id,
                    onClick: () => actions.onSelectDifficulty(item.id),
                    style: { ...btnStyle(meta.difficulty === item.id), textAlign: 'left', padding: '8px' },
                  },
                  h('div', { style: { fontWeight: '600', fontSize: '12px' } }, item.label),
                  h('div', { style: { fontSize: '11px', color: '#d3bbb0', marginTop: '2px' } }, item.desc),
                ),
              ),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '8px' } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: actions.onStartMission,
                  style: { ...primaryBtnStyle, flex: 1 },
                },
                'Iniciar Operação',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => actions.onToggleSettings(true),
                  style: btnStyle(false),
                },
                'Configurações',
              ),
            ),
          ),
        )
      : null,

    isPaused && !meta.settingsOpen
      ? h(
          'div',
          {
            role: 'dialog',
            'aria-modal': 'true',
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(12, 8, 6, 0.58)',
              pointerEvents: 'auto',
              font: '14px/1.45 system-ui, sans-serif',
            },
          },
          h(
            'div',
            {
              style: {
                width: 'min(330px, calc(100% - 32px))',
                padding: '20px',
                borderRadius: '14px',
                border: '1px solid #633c28',
                background: '#20130e',
                color: '#f5ece6',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              },
            },
            h('h2', { style: { margin: '0 0 4px', fontSize: '18px' } }, 'Operação Pausada'),
            h(
              'p',
              { style: { margin: '0 0 14px', fontSize: '12.5px', color: '#d3bbb0' } },
              `Sol ${sol?.solIndex ?? 1}/${sol?.targetSols ?? 10} · Etapa ${stage}/5`,
            ),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              h(
                'button',
                { type: 'button', onClick: actions.onResume, style: { ...primaryBtnStyle, width: '100%' } },
                'Continuar (ESC)',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => actions.onToggleSettings(true),
                  style: { ...btnStyle(false), width: '100%' },
                },
                'Configurações',
              ),
              h(
                'button',
                { type: 'button', onClick: actions.onRestart, style: { ...btnStyle(false), width: '100%' } },
                'Reiniciar Missão',
              ),
              h(
                'button',
                { type: 'button', onClick: actions.onMainMenu, style: { ...btnStyle(false), width: '100%' } },
                'Menu Inicial',
              ),
            ),
          ),
        )
      : null,

    meta.settingsOpen
      ? h(
          'div',
          {
            role: 'dialog',
            'aria-modal': 'true',
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(12, 8, 6, 0.68)',
              pointerEvents: 'auto',
              font: '14px/1.45 system-ui, sans-serif',
            },
          },
          h(
            'div',
            {
              style: {
                width: 'min(380px, calc(100% - 32px))',
                padding: '20px',
                borderRadius: '14px',
                border: '1px solid #633c28',
                background: '#20130e',
                color: '#f5ece6',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              },
            },
            h('h2', { style: { margin: '0 0 14px', fontSize: '18px' } }, 'Configurações'),
            h('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '6px' } }, 'Velocidade da câmera'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '12px' } },
              (
                [
                  { id: 'slow', label: 'Lenta' },
                  { id: 'normal', label: 'Normal' },
                  { id: 'fast', label: 'Rápida' },
                ] as const
              ).map((opt) =>
                h(
                  'button',
                  {
                    key: opt.id,
                    type: 'button',
                    'aria-pressed': meta.settings.cameraSpeed === opt.id,
                    onClick: () => actions.onUpdateSettings({ ...meta.settings, cameraSpeed: opt.id }),
                    style: btnStyle(meta.settings.cameraSpeed === opt.id),
                  },
                  opt.label,
                ),
              ),
            ),
            h('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '6px' } }, 'Resolução gráfica'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '12px' } },
              (
                [
                  { id: 'performance', label: 'Desempenho (1x)' },
                  { id: 'native', label: 'Alta (Nativa)' },
                ] as const
              ).map((opt) =>
                h(
                  'button',
                  {
                    key: opt.id,
                    type: 'button',
                    'aria-pressed': meta.settings.resolutionScale === opt.id,
                    onClick: () => actions.onUpdateSettings({ ...meta.settings, resolutionScale: opt.id }),
                    style: btnStyle(meta.settings.resolutionScale === opt.id),
                  },
                  opt.label,
                ),
              ),
            ),
            h('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '6px' } }, 'Duração do Sol'),
            h(
              'div',
              { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '14px' } },
              ([36, 48, 72] as const).map((sec) =>
                h(
                  'button',
                  {
                    key: sec,
                    type: 'button',
                    'aria-pressed': meta.settings.solDurationSec === sec,
                    onClick: () => actions.onUpdateSettings({ ...meta.settings, solDurationSec: sec }),
                    style: btnStyle(meta.settings.solDurationSec === sec),
                  },
                  `${sec}s`,
                ),
              ),
            ),
            h('div', { style: { fontSize: '12px', fontWeight: '600', marginBottom: '6px' } }, 'Controles'),
            h(
              'dl',
              {
                style: {
                  margin: '0 0 16px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: '#180e0a',
                  border: '1px solid #4d2f20',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '4px 12px',
                  fontSize: '12px',
                },
              },
              h('dt', { style: { color: '#ffb078', fontWeight: '600' } }, 'WASD / Setas'),
              h('dd', { style: { margin: 0, color: '#d3bbb0' } }, 'Mover câmera'),
              h('dt', { style: { color: '#ffb078', fontWeight: '600' } }, 'Q / E / Botão Direito'),
              h('dd', { style: { margin: 0, color: '#d3bbb0' } }, 'Girar câmera'),
              h('dt', { style: { color: '#ffb078', fontWeight: '600' } }, 'F'),
              h('dd', { style: { margin: 0, color: '#d3bbb0' } }, 'Girar construção'),
              h('dt', { style: { color: '#ffb078', fontWeight: '600' } }, 'ESC / P'),
              h('dd', { style: { margin: 0, color: '#d3bbb0' } }, 'Pausar ou cancelar'),
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () => actions.onToggleSettings(false),
                style: { ...primaryBtnStyle, width: '100%' },
              },
              'Fechar',
            ),
          ),
        )
      : null,

    showEndModal
      ? h(
          'div',
          {
            role: 'dialog',
            'aria-modal': 'true',
            style: {
              position: 'fixed',
              inset: 0,
              zIndex: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(12, 8, 6, 0.68)',
              pointerEvents: 'auto',
              font: '14px/1.45 system-ui, sans-serif',
            },
          },
          h(
            'div',
            {
              style: {
                width: 'min(360px, calc(100% - 32px))',
                padding: '20px 22px',
                borderRadius: '14px',
                border: `1px solid ${status === 'victory' ? '#58c49e' : '#cc5c5c'}`,
                background: '#20130e',
                color: '#f5ece6',
                boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
              },
            },
            h(
              'h2',
              {
                style: {
                  margin: '0 0 8px',
                  fontSize: '18px',
                  color: status === 'victory' ? '#7cdec0' : '#ff8585',
                },
              },
              status === 'victory' ? 'Posto Aurora entregue' : 'Missão encerrada',
            ),
            h(
              'p',
              { style: { margin: '0 0 14px', color: '#d3bbb0' } },
              endReason ??
                (status === 'victory'
                  ? 'A colônia resistiu e evoluiu nos 10 ciclos solares em Marte.'
                  : 'A integridade estrutural da base chegou a 0%.'),
            ),
            h(
              'ul',
              { style: { margin: '0 0 16px', paddingLeft: '18px', color: '#f5ece6' } },
              h('li', null, `Etapa alcançada: ${stage} / 5 (${stageTitle})`),
              h('li', null, `Ciclo alcançado: Sol ${sol?.solIndex ?? 1} / ${sol?.targetSols ?? 10}`),
              h('li', null, `Minério final: ${units.format(ore)} / ${oreCapacity} UJ`),
              h('li', null, `Impactos registrados: ${impactCount}`),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '8px' } },
              h(
                'button',
                {
                  type: 'button',
                  onClick: actions.onRestart,
                  style: { ...primaryBtnStyle, flex: 1 },
                },
                'Jogar Novamente',
              ),
              h(
                'button',
                {
                  type: 'button',
                  onClick: actions.onMainMenu,
                  style: btnStyle(false),
                },
                'Menu Inicial',
              ),
            ),
          ),
        )
      : null,
  );
}

export function mountSurvivalHud(
  initialState: BaseSurvivalState,
  initialMeta: SurvivalHudMeta,
  actions: SurvivalHudActions,
) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let last: BaseSurvivalState | undefined;
  let lastMeta: SurvivalHudMeta | undefined;

  function update(state: BaseSurvivalState, meta: SurvivalHudMeta = lastMeta ?? initialMeta): void {
    const ore = Math.floor(state.ore + 1e-9);
    const battery = Math.round(state.battery * 10) / 10;
    const activeRemaining = state.activeEvent ? Math.ceil(state.activeEvent.remainingSec) : 0;
    const lastRemaining = last?.activeEvent ? Math.ceil(last.activeEvent.remainingSec) : 0;
    const solStep = state.sol ? Math.floor(state.sol.solProgress * 50) : -1;
    const lastSolStep = last?.sol ? Math.floor(last.sol.solProgress * 50) : -1;

    const metaSame =
      lastMeta?.loadout === meta.loadout &&
      lastMeta?.difficulty === meta.difficulty &&
      lastMeta?.settingsOpen === meta.settingsOpen &&
      lastMeta?.settings.cameraSpeed === meta.settings.cameraSpeed &&
      lastMeta?.settings.resolutionScale === meta.settings.resolutionScale &&
      lastMeta?.settings.solDurationSec === meta.settings.solDurationSec;

    if (
      metaSame &&
      last?.ore === ore &&
      last.oreCapacity === state.oreCapacity &&
      last.integrity === state.integrity &&
      last.impactCount === state.impactCount &&
      last.impactAlert === state.impactAlert &&
      last.generation === state.generation &&
      last.demand === state.demand &&
      last.battery === battery &&
      last.batteryCapacity === state.batteryCapacity &&
      last.miners === state.miners &&
      last.supportCapacity === state.supportCapacity &&
      last.miningRate === state.miningRate &&
      last.weather === state.weather &&
      last.stage === state.stage &&
      last.stageTitle === state.stageTitle &&
      last.stageGoal === state.stageGoal &&
      last.activeEvent?.type === state.activeEvent?.type &&
      last.activeEvent?.phase === state.activeEvent?.phase &&
      lastRemaining === activeRemaining &&
      last.sol?.solIndex === state.sol?.solIndex &&
      last.sol?.phase === state.sol?.phase &&
      last.sol?.completed === state.sol?.completed &&
      lastSolStep === solStep &&
      last.status === state.status &&
      last.endReason === state.endReason
    ) {
      return;
    }

    last = { ...state, ore, battery };
    lastMeta = { ...meta, settings: { ...meta.settings } };
    render(h(SurvivalHud, { state: last, meta: lastMeta, actions }), root);
  }

  update(initialState, initialMeta);
  return {
    update,
    dispose(): void {
      render(null, root);
      root.remove();
    },
  };
}
