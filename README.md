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

Arquivos: `wrangler.jsonc` (configuração) e `worker/index.js` (Worker).

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
  icons.js             ícones SVG de tempo
  data/campings.js     campings monitorados (nome, município, mesorregião, coordenadas)
  data/sp-mesorregioes.geo.json   malha IBGE
Dockerfile             build multi-stage (Node → Nginx)
docker-compose.yml     serviço frontend
nginx.conf             SPA + cache dos assets
```

Para adicionar um camping, inclua uma entrada em `src/data/campings.js`, com o nome exato da mesorregião do IBGE.
