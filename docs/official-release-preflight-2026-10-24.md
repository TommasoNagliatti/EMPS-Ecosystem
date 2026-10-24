# Preparação da versão oficial — 24/10/2026

## Resultado desta etapa

Promoção solicitada para `emps-charge.tech`, preservando a prévia, a versão local,
contas e histórico existentes. **Domínio, backend e MySQL oficiais ainda não alterados.**

- Backup completo oficial criado, gzip verificado e duas restaurações isoladas testadas.
- Fonte oficial observada: `a788d1c8970a2830ace8ad55eab815709723ef41`, com hotfix
  existente em `admin-operations.service.ts`, preservado em patch privado.
- Fonte nova parte de `4ea2d5d`; branch `feat/gie-esp32-realtime`.
- `main` observado em `3fc3bc5`; 24 commits da branch ainda não integrados.
  A PR #10 continua em rascunho, baseada na branch da PR #9. Isso não é merge em main.
- Banco oficial: 15 usuários, 8 estações, 13 carregadores, 77 sessões,
  77 pagamentos e 53 payment intents na auditoria. Nenhuma sessão ACTIVE;
  há 16 payment_pending, 60 completed e 1 interrupted. Não reprocessar esses dados.
- Estação 13 existente conserva proprietário 64; Shopping 39 conserva proprietário 105.
- Códigos conferidos no oficial: EV1 `CH-f2f059af5117b95fb970` → 51;
  EV2 `CH-26f5af4e137bbe735ed5` → 49; ambos vinculados a 13.

## Correção da indisponibilidade no App

O App confundia OFFLINE físico com indisponibilidade do simulador. Agora QR,
consulta do carregador e atualização da estação usam a mesma autorização SANDBOX
do backend. O status físico continua OFFLINE/UNKNOWN, sem simular telemetria.
O contrato explícito `sandbox` informa disponibilidade, ocupação e motivo do bloqueio.
Cenas/GIE indisponível bloqueiam início; START continua verificando a sessão,
o QR e a autorização no backend. Não há autorização por potência alocada.
Nenhum CSS do Site, firmware ou algoritmo GIE foi alterado nesta correção.

Testes: App 42 passaram, typecheck passou; Backend build passou, 229 passaram,
8 testes MySQL opcionais ignorados. Dois testes de rede falharam inicialmente
por EACCES do sandbox e passaram ao repetir com loopback autorizado.

## Estrutura proposta

Pacote `0012-official-demo-runtime-schema.sql/.md`: 14 tabelas novas, cinco
campos opcionais/default em alerts, índices/FKs e 21 CHECKs. Sem importação ou DML.
Validado numa restauração isolada com hashes preservados dos registros financeiros,
usuários, estações e carregadores. A política exige aprovação específica do SQL,
backup recente e commit revisado antes de aplicação oficial.

## Pendências que impedem a troca segura

1. Aprovação concreta do pacote estrutural e sequência administrativa sem contornar gates.
2. A exceção atual de SANDBOX/maquete aceita apenas a cópia `emps_integration_test`.
   É necessária uma política explícita para demonstração no oficial, com identificação
   do banco e escopo de estações/equipamentos verificados. Não afrouxar a guarda local.
3. Pacote de dados idempotente separado: renomear 13, conservar seus 3 equipamentos,
   vincular o perfil comercial; acrescentar Posto/Residência privados sem colisão;
   manter Shopping e proprietários; decidir membros administrativos de cada conta.
   Importar somente histórico demonstrativo, com proveniência e deduplicação da rede.
4. Preparar e validar stack candidata isolada com cópia oficial e os novos dados,
   autenticação antiga e novos modos; preservar o hotfix de caixa já existente.
5. Revisar/integrar a versão em main; publicar imagens imutáveis; validar candidato
   antes de encaminhar o domínio. Troca por proxy e rollback testados, sem substituir
   a base oficial por dump local/sanitizado. Código e banco têm rollback diferente.
6. Atualizar origem permitida da ponte ESP e destino Expo para o oficial com token
   dedicado, preservando fallback local e a autoridade única de comando.
   A autorização física USB anterior venceu em 24/10 às 07:21:58 de São Paulo;
   não renovar nem transportar uma autorização vencida. A indicação energética
   pode continuar sem liberação de relés.

Prévia e ambiente local continuam sendo os alvos de teste enquanto estas pendências
não forem concluídas. Este documento não declara deploy oficial concluído.
