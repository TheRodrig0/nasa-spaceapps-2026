# Ligando a sobrevivência no jogo

No `src/game/sandbox-app.ts`, cria uma instância por partida.

```ts
import { BaseSurvivalSystem } from '../systems/survival/BaseSurvivalSystem.ts';
import { getConstructionCost } from '../systems/survival/economy.ts';
import { mountSurvivalHud } from '../ui/survival-hud.ts';

const base = new BaseSurvivalSystem();
const hud = mountSurvivalHud(base.getState(), () => {
  base.repair();
  hud.update(base.getState());
});
```

- **Loop:** chama `base.update(dt, { buildings: prediosAtivos, weather })` e depois `hud.update(base.getState())`. O `dt` é em segundos e a lista usa só o `definitionId` de cada prédio ativo. O clima aceita `clear`, `dust-storm` ou `electrical-storm`. Se omitir, fica limpo.
- **Construção:** `getConstructionCost(id)` dá o custo pro menu. Pra prévia, usa `base.canBuild(id, prediosAtivos)`. Na confirmação, valida o terreno e deixa o modelo pronto. Antes de inserir o prédio na lista, chama `base.tryPayForBuilding(id, prediosAtivos)`. Só insere se retornar `true`. Faz a cobrança e a inserção juntas, sem `await` entre elas.
- **Meteoro e tornado:** usa a quantidade de prédios atingidos que o EventManager já calcula. Chama `base.applyImpact(quantidade)` uma vez por evento, contando cada prédio atingido só uma vez. Se teu evento já dispara por prédio, chama `base.applyImpact()` só no primeiro acerto daquele prédio naquele evento.
- **Reinício:** chama `hud.dispose()` ao desmontar a partida e cria outro sistema na próxima.

Pra testar rápido, constrói Alojamento, Estufa, Gerador Solar, Bateria e Usina. Em tempo limpo, o minério sobe e a bateria carrega. Na tempestade, a bateria banca a usina até esgotar. O botão Reparar usa o mesmo minério da construção.

Os números de teste ficam em `src/systems/survival/economy.ts`.
