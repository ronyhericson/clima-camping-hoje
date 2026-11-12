# ClimaCampingHoje

Mapa dinâmico do estado de São Paulo (React + Apache ECharts) com o **tempo agora** nos campings mais conhecidos de cada mesorregião, seguindo a metodologia do *Prompt Clima / Chuva (Por outras Bandas)*.

## O que o site faz

- **Mapa coroplético** das 15 mesorregiões de SP (malha oficial do IBGE), colorido pelo pior **laudo de risco por cores** (verde, amarelo, laranja, vermelho) entre os campings da região.
- **Ícones de tempo** em cada camping: sol (ou lua à noite), sol entre nuvens, nublado, chuva e tempestade. Pontos com risco elevado pulsam.
- **Painel do camping** (clique no ícone): tempo agora, laudo do dia em texto operacional, quadro consolidado (mínimo, máximo, média, mediana, intervalo de maior concentração, divergências), períodos do dia (madrugada → noite), comparativo por fonte, grau de confiança, orientações de segurança e links para conferir em outros serviços.
- Atualização automática a cada 15 minutos e botão **Atualizar**.
- Layout responsivo em tela cheia: painel lateral no desktop, painel inferior no celular.

## Fontes de dados

| Uso | Fonte |
| --- | --- |
| Previsão e “agora” (6 fontes independentes) | ECMWF, GFS/NOAA, ICON/DWD, UKMO, Météo-France (ARPEGE) e JMA via [Open-Meteo](https://open-meteo.com) (gratuito, sem chave) |
| Reserva (só quando a Open-Meteo falha) | [MET Norway](https://api.met.no) (base do yr.no; gratuito, sem chave), consultada pelo Worker |
| Limites das mesorregiões | [API de malhas do IBGE](https://servicodados.ibge.gov.br/api/docs/malhas) (arquivo em `src/data/`) |
| Conferência manual | Links para Climatempo, Meteored, AccuWeather, Alertas INMET, Defesa Civil SP, radar IPMet, CPTEC/INPE e Windy |

Climatempo, AccuWeather, Meteored, INMET e Defesa Civil não têm API pública que o navegador consiga chamar, então entram como links. O site não simula dados: se a consulta falhar, ele mostra um aviso.

O laudo de cores é uma **classificação operacional automática**. Ele não substitui alertas oficiais.

## Rodar

### Docker Compose (recomendado)

```bash
docker compose up -d --build
```

Acesse http://localhost:8090. Para usar outra porta: `PORT=3000 docker compose up -d --build`.

### Desenvolvimento local

```bash
npm install
npm run dev
```

## Publicar na Cloudflare (Workers)

Em produção, um Worker serve o site e consulta a Open-Meteo **uma vez para todos os visitantes**
a cada 30 min (Cron Trigger), guardando o resultado no **Workers KV**. O navegador lê `/api/clima`.
Custo fixo ≈ 2.700 chamadas/dia na Open-Meteo ("tempo agora" a cada 30 min; os 6 modelos a cada 3 h),
dentro do plano gratuito, não importa quantos visitantes. Se `/api/clima` não estiver disponível
(ex.: rodando com Docker), o site consulta a Open-Meteo direto do navegador, com cache local.

Arquivos: `wrangler.jsonc` (configuração), `worker/index.js` (Worker) e `worker/metno.js` (fonte reserva).

**Se a Open-Meteo falhar** (ex.: limite diário), o Worker tenta, nesta ordem:

1. **Modelos de hoje já guardados.** Usa os 6 modelos da última consulta do dia, mesmo com mais de 3 h, e pega o "tempo agora" na MET Norway.
2. **MET Norway sozinha.** Usada quando ainda não há modelos do dia: previsão de uma fonte só, com confiança "baixa".
3. **Última consulta boa no KV.** Se as duas fontes falharem, `/api/clima` continua servindo o último resultado, com o horário dele.

Quando a reserva está em uso, o site mostra "⚠ Fonte reserva em uso" na legenda e um aviso no laudo do camping.
O cron volta a tentar a Open-Meteo a cada 30 min.

A MET Norway exige um User-Agent que identifique o app. Ajuste `vars.METNO_UA` no `wrangler.jsonc`
com o endereço do seu site, por exemplo `"ClimaCampingHoje/1.0 https://seusite.workers.dev"`
([termos de uso](https://api.met.no/doc/TermsOfService)).

**Primeira vez**

1. `npx wrangler@4 login`
2. `npx wrangler@4 kv namespace create CLIMA` e copie o `id` exibido para `wrangler.jsonc`
   (no lugar de `COLE_AQUI_O_ID_DO_KV`).
3. Confira se `"name"` em `wrangler.jsonc` é o nome do seu Worker no painel (`climacampinghoje`).
4. `npm run cf:deploy`

**Atualizações**: `npm run cf:deploy`.

**Testar o Worker localmente**: `npm run cf:dev` e abra http://localhost:8787
(cron manual: http://localhost:8787/__scheduled?cron=*/30+*+*+*+*).

**Conferir no painel** (Workers & Pages → climacampinghoje):
- *Settings → Triggers*: Cron `*/30 * * * *`;
- *Bindings*: KV `CLIMA`; em *Storage & Databases → KV → CLIMA* aparecem as chaves `clima:v1` e `modelos:v1`;
- *Observability → Logs*: execuções do cron e erros (ex.: limite da Open-Meteo).

Licença: o plano gratuito da Open-Meteo é para uso **não comercial**.

## Estrutura

```
src/
  App.jsx              layout, painel e laudos
  MapView.jsx          mapa ECharts (geo + map + scatter + effectScatter)
  weather.js           coleta multimodelo e consolidação (metodologia do prompt)
worker/
  index.js             Worker: site + /api/clima + cron + cache no KV
  metno.js             fonte reserva MET Norway (convertida para o formato da Open-Meteo)
  icons.js             ícones SVG de tempo
  data/campings.js     campings monitorados (nome, município, mesorregião, coordenadas)
  data/sp-mesorregioes.geo.json   malha IBGE
Dockerfile             build multi-stage (Node → Nginx)
docker-compose.yml     serviço frontend
nginx.conf             SPA + cache dos assets
```

Para adicionar um camping, inclua uma entrada em `src/data/campings.js`, com o nome exato da mesorregião do IBGE.


