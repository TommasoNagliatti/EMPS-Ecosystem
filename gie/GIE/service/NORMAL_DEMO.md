# NORMAL demonstrativo (19/09/2026)

`GIE_NORMAL_DEMO=true` habilita o adapter em `service/api.py`; sem a variável,
o comportamento seguro anterior é preservado. `GIE_WEATHER_ENABLED=true` permite
Open-Meteo cloud_cover: timeout 1,5 s, cache 20 minutos, validação de horário/faixa.
Sem rede ou resposta válida: cobertura 35%, funções determinísticas de horário local.

As sessões e vínculos EVSE vêm de `/context`, autenticado. Expiração de 15 s retira
o resultado válido. O ciclo respeita limite de 5 s salvo mudança de contexto.
Os forecasts demonstrativos alimentam o runtime/MPC/LB congelado; não se apresentam
como previsões LightGBM nem como medições reais. A grade do runtime é alinhada a
15 minutos em America/Sao_Paulo. Prédio: curva diária 70-160 kW; solar: curva diurna
reduzida por nebulosidade. SOC começa em 50% em cada processo e integra segundos
efetivos (máximo 15 s), com parâmetros do perfil V2: 2000 kWh e eficiência 0,95.
Não usa a projeção de SOC de 15 minutos como passagem real de tempo.

Presentation/Manual Demo e todos os arquivos do manifesto frozen permanecem
inalterados. A verificação atual tem zero diferenças; o antigo relatório
`docs/release/frozen-presentation-audit.json` descreve um mismatch histórico já
resolvido no HEAD recebido, não uma falha atual. Nenhum hash foi atualizado aqui.

Início recomendado: launcher do backend descrito em `site/emps-site-main/STARTUP.md`.
Testes: `.venv/Scripts/python.exe -B -m unittest discover -s tests/service -v`;
controle/dashboard: `.venv-demo/Scripts/python.exe -B -m unittest discover -s tests/gie_control -v`.
O venv demo precisa também dos requisitos base, inclusive SciPy.
