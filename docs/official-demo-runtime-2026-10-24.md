# Runtime demonstrativo oficial — 24/10/2026

## Estado da publicação

PR #11 integrada em `main` com aprovação específica. Estrutura 0012 e pacote de
dados v2 aplicados com aprovações separadas. Este complemento prepara a execução
no banco oficial; **não declara a troca do domínio concluída**. Nenhum CSS,
componente visual, App, SubApp, firmware ou modelo matemático alterado aqui.

### Dados aplicados e auditados

- Backup novo anterior aos dados: `emps-backup-20261024T140840Z`, preservado na VPS.
- Pacote gzip SHA256 `2f0b401e38e571d68cc8d0f748152e91de7b014ad13d9da57a680b3b25391d7b`.
- SQL descompactado SHA256 `f77c4dc4cc1cbca28e2b2e112820632cc5c08ca2e7d0bf7e41f13e7277d10085`.
- 232 instruções DML numa transação SERIALIZABLE. Aplicação única; gate posterior
  `MATCH` permite somente no-op. Não apagar recibos para reexecutar.
- 13.285 registros de sessões/tentativas, incluindo não atendidas; 7.961 pagamentos
  demonstrativos; 104.832 intervalos energéticos; 42 regras residenciais versionadas.
- Oficial após importação: 15 usuários, 10 estações, 16 carregadores;
  **77 sessões, 77 pagamentos e 53 payment intents operacionais preservados**.
- Hashes das linhas antigas conferidos. A comparação conservadora da estação 13
  sinalizou diferença; restauração do backup em banco isolado confirmou somente
  `station_name` autorizado e `updated_at` automático do MySQL. Nenhum outro campo
  antigo mudou, inclusive `guest_allowed=false`. Auditoria/recibo privados mantêm
  o resultado inicial e a explicação, sem mascarar a ocorrência.
- Proprietários 64/105, senhas e papéis globais mantidos; MANAGER 64 em 39/46/47.
  Posto/Residência continuam DRAFT/PRIVATE/SIMULATED, carregadores PENDING.

## Admissão do runtime

`official-demo-runtime.ts` mantém a guarda da cópia local intacta. Para habilitar
a exceção oficial, exige `NODE_ENV=production`, opt-in `EMPS_OFFICIAL_DEMO_RUNTIME=OFFICIAL`,
hashes aprovados `EMPS_OFFICIAL_SCHEMA_SHA256` e `EMPS_OFFICIAL_DATA_SHA256`, conexão
MySQL não-root em loopback 3306 e identificação real do banco/UUID MySQL 8.0.

Antes de inicializar Nest, uma transação somente de leitura verifica proprietários,
permissões, estação/dispositivo, códigos EV1/EV2, carregadores PENDING, os três
vínculos GIE SIMULATED e os quatro manifests. Shopping permanece no GIE legado.
Flag sem verificação não concede exceção. Mudança da configuração invalida a
admissão; falha no startup bloqueia o candidato antes de iniciar jobs.

O modo `REHEARSAL` exige outro UUID e o banco exclusivo `emps_official_runtime_test`
na porta 3308, bind loopback e pagamentos/comandos físicos desativados. Não aceita
UUID oficial, chaves Stripe ou escopo USB para acionar hardware.

- As exceções de recarga continuam limitadas a 13/46/47 e às tabelas `lab_*`.
- Histórico demonstrativo admite MANAGER somente nas quatro estações aprovadas,
  com nova verificação de acesso por estação. Não promove contas globalmente.
- O consolidado mantém a deduplicação entre Prédio/Shopping, que reutilizam a
  mesma origem. Quatro experiências representam três fontes independentes.
- Stripe da maquete aceita somente chaves de TESTE, namespace `emps_db` e IDs
  próprios do laboratório. A configuração operacional global não é substituída.
- A autorização USB anterior venceu: **SERIAL_ONLY** por padrão. Escopo separado
  `EMPS_OFFICIAL_USB_RELAY_SCOPE=LOW_VOLTAGE_USB_ONLY` não substitui aprovação
  elétrica, polaridade, capacidade, sessão e prazo válido máximo de oito horas.
  Nenhuma renovação física realizada nesta etapa.

## Ponte e fallback

`switch-maquete-source.ps1` acrescenta `HostingerOfficial`, com allowlist exclusiva
`https://api.emps-charge.tech` e opt-in distinto de `HostingerPreview`. Credencial
LAN nunca sai do computador; upstream usa outra credencial privada. Sem redirects
ou failover automático. A troca exige ausência de sessões nos dois lados e aguarda
o watchdog antes de iniciar uma única autoridade. Local e prévia permanecem opções.

O endpoint autenticado de dispositivo `GET /devices/maquete-01/energy/authority`
informa apenas vínculo, disponibilidade GIE e contagem de sessões, sem abrir um
stream ou expor usuários. Dispensa armazenar a senha administrativa oficial na ponte.
Não há troca automática da origem executando no computador.

## Evidências de teste

- Backend: build passou; suíte completa com concorrência 2 e loopback autorizado:
  **233 passaram, zero falhas, oito MySQL opcionais ignorados**.
- Ponte: **10 testes passaram**, incluindo autenticação, ACK, heartbeat, allowlists
  local/prévia/oficial, indisponibilidade e ausência de fallback automático.
- Restauração de ensaio: **44 tabelas com hashes de linhas idênticos à cópia v2**,
  credencial própria não-root e nenhuma porta pública.
- Consultas reais MySQL: 13 e 39 com 2.917 sessões atendidas cada/R$101.381,31 cada;
  46 com 2.085/R$86.890,68; 47 com 42/R$434,72. Valores dos eventos importados
  preservados; compartilhamento 13/39 excluído da soma consolidada.
- Residência: **32 próprias sem receita e dez visitantes/R$434,72**. Não criou bateria.
- Login HTTP na cópia com senha temporária somente na cópia, restaurada ao terminar;
  usuário 64 autenticado, 401 sem token e acesso de conta estranha negado.
- Quatro GIEs disponíveis: comercial V3, Shopping legado, Posto e Residência.
  Novos workers V3 separados inicializaram+executaram um ciclo nativo em
  3,15 s / 4,45 s / 5,01 s, com gerações distintas e decisões válidas.
- Modos NORMAL/SIMULATION/PRESENTATION/MANUAL_DEMO e overlay CHARGER_DEMO testados
  via API autenticada da cópia. Snapshot/ACK válido, medição física falsa,
  relés SERIAL_ONLY. Teste de dispositivo foi **simulado**, sem ESP físico.
- Duas recargas de caixa SANDBOX iniciadas pela API da cópia: parar EV1 preservou
  EV2 CHARGING; depois ambas encerradas, zero sessões ativas. Nenhum pagamento
  externo; contagens operacionais continuaram 77/77/53.

## Pendências de promoção

1. Revisão/CI e aprovação específica do merge deste complemento, além da PR #11
   já integrada. Nenhum novo SQL estrutural ou pacote de dados é necessário.
2. Imagens imutáveis e candidato oficial com workers próprios, recibos e comparação
   de schema. O update antigo mantém seu bloqueio de diff de banco; não contornar.
3. Troca controlada/graciosa de Caddy após verificações, preservando configuração,
   imagens antigas, prévia e ambiente local. Rollback de código não desfaz dados.
4. Configurar destino oficial da ponte/Expo e conferir login do proprietário e QR
   no domínio oficial. Não afirmar testes visuais oficiais antes de realizá-los.
5. Nova aprovação física, se solicitada, para testes dos relés na maquete real.
