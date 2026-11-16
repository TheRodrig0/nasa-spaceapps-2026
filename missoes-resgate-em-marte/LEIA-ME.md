# Campanha científica de Resgate em Marte

Este pacote pertence à versão com Walker e extração. A versão de base fixa desta branch fica na raiz do repositório. As rotas abaixo dependem do projeto original do Walker.

Copie a pasta `src` deste pacote sobre a pasta `src` do projeto original, mantendo os caminhos internos. Se os mesmos arquivos tiverem mudanças locais, compare as versões antes de substituir. Remova `src/world/extraction/ExtractionMarker.ts`, que deixou de ser usado.

O pacote contém os arquivos anotados da campanha e depende do restante do projeto. Para executar o jogo completo, rode `npm ci` e `npm run dev` na raiz do projeto. O código também está integrado à versão do navegador.

As seis rotas têm ações de campo que só podem ser executadas dentro do alcance. A seta flutuante amarela aponta para o centro do objetivo ou da extração. Quando uma ação de campo estiver ao alcance, a seta fica verde. O HUD e o minimapa ajudam a orientar a rota. Ao entrar no alcance, solte W e pressione C ou clique na ação do HUD. A vitória salva o progresso e inicia automaticamente a próxima missão no mesmo mapa, a partir da posição atual do Walker e com a mesma dificuldade. A campanha científica tem um progresso próprio no navegador.

Para verificar as regras:

```bash
node --import tsx --test src/systems/campaign.test.ts src/world/volcanic/VolcanicFront.test.ts
```
