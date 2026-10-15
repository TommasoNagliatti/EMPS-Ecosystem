# Teste visual local integrado (PRs #1, #2 e #3)

Resultados da validação no navegador e da retomada dos serviços:
[GIE_DEMO_VISUAL_LOCAL_RESULTS_2026-10-15.md](GIE_DEMO_VISUAL_LOCAL_RESULTS_2026-10-15.md).

No PowerShell, na raiz deste repositório:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-demo-visual.ps1
```

O script exige Docker Desktop, Node.js/npm e Python 3.12 (`py -3.12`) somente se
o ambiente Python local ainda não existir. Ele instala as dependências dos
projetos ausentes, cria ou reutiliza exclusivamente o contêiner descartável
`emps-demo-visual-mysql` na porta `127.0.0.1:3307`, aplica o schema-base e os
patches 0001/0002 em banco vazio, cria a conta local e as três instalações,
importa os históricos de forma idempotente e inicia GIE, API e Site. O script
recusa banco parcialmente aplicado, porta ocupada por serviço desconhecido e
contêiner com volume nomeado, bind mount, imagem ou identidade divergente.
Nenhum comando acessa o contêiner usual `emps-mysql` na porta 3306.

As credenciais locais são geradas uma vez em `C:\goodwill_ai\.emps-demo-visual-runtime.json`
e `C:\goodwill_ai\.emps-demo-visual-db.json`, fora do repositório, e
reutilizadas em retomadas. Não copie esses arquivos para Git ou para a VPS.
O launcher também grava `C:\goodwill_ai\.emps-demo-visual-processes.json` com
PID, horário de criação e hash da configuração dos serviços que iniciou.
Quando uma porta já está ocupada, ele só reutiliza o processo se esse registro
coincidir com o listener local atual. Um Backend ou Next.js iniciado por outro
comando é recusado, mesmo que responda à rota de saúde ou à página de login.
Se houver serviços antigos sem esse registro, encerre esses serviços locais
manualmente e execute o launcher de novo; o MySQL descartável e seus dados
podem continuar em execução.
O script exibe o e-mail e a senha locais no terminal ao terminar. A Shopping
existente da mesma conta é preservada; se houver uma cópia sanitizada com ID
específico, defina `DEMO_VISUAL_COMMERCIAL_STATION_ID` antes de executar e o
script verificará titularidade e estado comercial, sem modificar o registro.

Endereços padrão:

- Site e login: `http://127.0.0.1:3000/login`
- Comparativo: `http://127.0.0.1:3000/stations/overview`
- API: `http://127.0.0.1:3001/auth/health`
- GIE legado: `http://127.0.0.1:8510`
- GIE multiestação: `http://127.0.0.1:8520`

No Site, entre com a conta indicada pelo script. Em **Minhas estações**, abra
Shopping Frei Caneca, Posto 24h e Residência. O histórico energético e
financeiro demonstrativo deve trazer os totais importados, gráficos mensais e
filtros por período, canal (App, Web, Caixa) e pagamento (Pix, cartões,
dinheiro). No comparativo, confira as três instalações e o rótulo simulado.
O financeiro operacional é separado; na base descartável nova ele permanece
zerado. Posto e Residência ficam DRAFT/PRIVATE/SIMULATED, sem pagamentos ou
comandos físicos. A Shopping usa seu vínculo GIE legado comercial.

Os processos locais ficam ativos após o script terminar. Seus logs novos estão
em `tmp/demo-visual/`. O contêiner usa volume **anônimo** criado pela imagem
MySQL e `--rm`; pará-lo elimina somente esses dados descartáveis. O script
não encerra serviços existentes, não faz deploy nem merge.
