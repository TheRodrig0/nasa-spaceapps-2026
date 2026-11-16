import { h, render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  BUILDING_CATALOG,
  BUILDING_CATEGORIES,
  BuildSystem,
  getConstructionCost,
} from '../systems/index.ts';
import type { BuildingCategory } from '../types/index.ts';
import { translatorFor } from './i18n.ts';
import type { Locale, Translator } from './i18n.ts';

const panelFrame = new URL('./assets/kenney/panel.png', import.meta.url).href;
const activeButtonFrame = new URL('./assets/kenney/active-button.png', import.meta.url).href;

function translateBuildReason(reason: string, t: Translator): string {
  const unlockStage = /^Desbloqueia na Etapa (\d+)$/.exec(reason);
  return unlockStage ? t('Desbloqueia na Etapa {0}', unlockStage[1]) : t(reason);
}

function BuildMenuApp({ buildSystem, locale }: { buildSystem: BuildSystem; locale: Locale }) {
  const t = translatorFor(locale);
  const [activeCategory, setActiveCategory] = useState<BuildingCategory>('casas');
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsub = buildSystem.onChange(() => setTick((n) => n + 1));
    const timer = window.setInterval(() => setTick((n) => n + 1), 400);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [buildSystem]);

  const selected = buildSystem.getSelectedDefinition();
  const rotation = buildSystem.getRotationDeg();
  const placedCount = buildSystem.getPlacedCount();
  const selectedBlockReason = selected ? buildSystem.getBuildBlockReason(selected.id) : null;
  const items = BUILDING_CATALOG.filter((b) => b.category === activeCategory);

  return h(
    'div',
    {
      style: {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        padding: '16px',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      },
    },
    selected
      ? h(
          'div',
          {
            style: {
              pointerEvents: 'auto',
              marginBottom: '10px',
              background: 'rgba(18, 13, 11, 0.90)',
              border: '1px solid rgba(255, 148, 77, 0.55)',
              borderRadius: '10px',
              padding: '8px 14px',
              color: '#f5ece6',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              backdropFilter: 'blur(8px)',
            },
          },
          h('span', null, t('Construindo: {0} ({1}°)', t(selected.name), rotation)),
          h(
            'span',
            { style: { color: selectedBlockReason ? '#e08a8a' : '#b7a49a' } },
            selectedBlockReason ? translateBuildReason(selectedBlockReason, t) : t('Clique para posicionar'),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => buildSystem.rotateSelection(),
              style: {
                background: '#2c201a',
                color: '#ffb078',
                border: '1px solid #593d2e',
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: '12px',
              },
            },
            t('Girar (F)'),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: () => buildSystem.selectBuilding(null),
              style: {
                background: '#381b1b',
                color: '#ff9c9c',
                border: '1px solid #6e2f2f',
                borderRadius: '6px',
                padding: '4px 10px',
                cursor: 'pointer',
                fontSize: '12px',
              },
            },
            t('Cancelar (Esc)'),
          ),
        )
      : null,

    h(
      'div',
      {
        style: {
          pointerEvents: 'auto',
          background: 'rgba(20, 14, 12, 0.92)',
          border: '1px solid #423026',
          borderImage: `url("${panelFrame}") 16 / 6px stretch`,
          padding: '10px 14px',
          maxWidth: '820px',
          width: '100%',
          boxShadow: '0 14px 36px rgba(0, 0, 0, 0.55)',
          backdropFilter: 'blur(10px)',
        },
      },
      h(
        'div',
        {
          style: {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            gap: '8px',
            flexWrap: 'wrap',
          },
        },
        h(
          'div',
          { style: { display: 'flex', gap: '6px' } },
          BUILDING_CATEGORIES.map((cat) => {
            const active = cat.id === activeCategory;
            return h(
              'button',
              {
                key: cat.id,
                type: 'button',
                'aria-pressed': active,
                onClick: () => setActiveCategory(cat.id),
                style: {
                  background: active ? '#ff8533' : '#261c17',
                  color: active ? '#180e08' : '#e6d8cf',
                  border: active ? '1px solid #ffad70' : '1px solid #433128',
                  borderImage: active ? `url("${activeButtonFrame}") 18 / 4px stretch` : undefined,
                  borderRadius: active ? 0 : '8px',
                  padding: '6px 14px',
                  fontWeight: active ? '700' : '500',
                  fontSize: '13px',
                  cursor: 'pointer',
                },
              },
              t(cat.label),
            );
          }),
        ),
        h(
          'div',
          {
            style: {
              fontSize: '12px',
              color: '#bfa99d',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
            },
          },
          h('span', null, t('Construídas: {0}', placedCount)),
        ),
      ),

      h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: '8px',
          },
        },
        items.map((def) => {
          const isSelected = selected?.id === def.id;
          const cost = buildSystem.getBuildCost(
            def.id,
            getConstructionCost(def.id) ?? def.oreCost,
          );
          const blockReason = buildSystem.getBuildBlockReason(def.id);
          return h(
            'button',
            {
              key: def.id,
              type: 'button',
              onClick: () => buildSystem.selectBuilding(def),
              style: {
                textAlign: 'left',
                background: isSelected ? '#3c2519' : '#1f1714',
                border: isSelected ? '1px solid #ff8c42' : '1px solid #382820',
                opacity: blockReason ? 0.68 : 1,
                borderRadius: '10px',
                padding: '9px 11px',
                color: '#f5ece6',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              },
            },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '6px',
                },
              },
              h(
                'span',
                { style: { fontWeight: '600', fontSize: '13px', color: isSelected ? '#ffb078' : '#f5ece6' } },
                t(def.name),
              ),
              h(
                'span',
                {
                  style: {
                    fontSize: '11px',
                    color: '#bfa99d',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  },
                },
                `${cost} UJ · ${def.cols}×${def.rows}`,
              ),
            ),
            h(
              'span',
              {
                style: {
                  fontSize: '11px',
                  color: blockReason ? '#e08a8a' : '#a8948a',
                  lineHeight: '1.3',
                },
              },
              blockReason ? translateBuildReason(blockReason, t) : t(def.description),
            ),
          );
        }),
      ),
    ),
  );
}

export function mountBuildMenu(buildSystem: BuildSystem) {
  const root = document.getElementById('ui-root');
  return {
    setLocale(locale: Locale): void {
      if (root) render(h(BuildMenuApp, { buildSystem, locale }), root);
    },
    dispose(): void {
      if (root) render(null, root);
    },
  };
}
