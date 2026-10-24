# Integração local: carregadores, fluxo e QR — validação em andamento

## Base preservada

- Branch `feat/end-to-end-charging-dashboard-qr`, derivada de `1efa668` (PR #9).
- Consulta remota em 20/10/2026: PR #9 continua em `1efa668`; nenhuma atualização posterior do colaborador encontrada. A branch de compatibilidade `6d5c0f8` já integra a cadeia. Não foi feito merge de `main` sobre o trabalho.
- Backend exclusivamente no clone `127.0.0.1:3308/emps_integration_test`. Bancos 3306/3307, Hostinger e modelos treinados preservados.
- Auditoria posterior aos testes: 65 sessões operacionais, 61 pagamentos, 45 intenções, 11 usuários; 43 sessões lab, todas finalizadas. As sessões lab incluem os testes anteriores e desta etapa.
- Backup consistente externo ao Git: `emps_integration_pre_cashier_prepaid_20261020T204129Z_32b4eb30.sql.gz`; 226.665.908 bytes descompactados; SHA-256 `7C85D5B4AB88A7F95AD319B9965C74F4CB2041AD830DD57933C983D5A19D6BB7`. A verificação leu o gzip integralmente e conferiu o tamanho e o cabeçalho do dump. Restauração em outro contêiner não executada nesta etapa.

## Correções implementadas

- Polling sandbox independente da aba histórica; descarte em troca de estação, falha e ocultação da página. EV1 e EV2 são identificados explicitamente, independentemente da ordem dos registros.
- Modo Normal do Posto usa as sessões locais atuais; apresentação mantém as decisões GIE. A seleção do histórico é independente do modo GIE. Instalações demonstrativas iniciam com histórico SIMULATED e datas originais. O seletor do histórico operacional continua separado.
- Cenário atual do Posto `POSTO_CLOCK_ENVELOPE_V1`: hipótese determinística solar 06–18h no timezone cadastrado, rendimento de pico 65%, carga predial 4–6 kW. Sem alegação de clima medido. Limites DC/AC/rede vêm do cadastro. Baterias ociosas e sem SoC inventado; SoC individual da apresentação GIE não é transferido para este cenário. Solar noturna zero; balanço validado; excedente solar limitado pela exportação. Configuração incompatível retorna indisponível.
- As potências históricas GIE não são somadas às sessões atuais. Receita operacional, histórica e sandbox continuam separadas.
- Caixa permite ao mesmo atendente administrar os dois EVSEs, mantendo bloqueio por carregador. Web/App pessoal mantém regra de uma sessão por conta. `actorUserId` do caixa identifica o atendente, não um motorista fictício.
- QR na página Carregadores e no card usa o mesmo token público estável e a origem configurada `NEXT_PUBLIC_WEB_CHARGE_ORIGIN`. A exceção sandbox exige autenticação e permissão da estação privada.
- Web Charge reconhece a autorização explícita sandbox sem converter `UNKNOWN/OFFLINE/PENDING` em disponibilidade física. Identificadores idempotentes usam bytes criptográficos, compatíveis com prévia HTTP LAN.
- Web Charge recebe `outcome` e comprovante apoiado no pagamento lab persistido. Não gera uma segunda cobrança; valor não utilizado da autorização não vira dívida ou restituição externa fictícia.
- Rótulo do caixa informa recebimento externo com confirmação manual. Chaves React dos componentes por estação deixam de colidir. CSS, layout e assets administrativos não foram modificados.

## Evidências executadas

- Frontend: 239 testes passaram (incluem QR, isolamento, disponibilidade física, fases da sessão, histórico e Web Charge).
- Backend: suíte de 196 testes, 187 passaram, 8 ignorados e 1 falhou por conexão WebSocket bloqueada no ambiente restrito. O teste WebSocket foi repetido com acesso local autorizado e passou: isolamento de estações e revogação imediata.
- Build Backend passou. Build Next.js completo com `--webpack` passou, incluindo TypeScript e 18 páginas estáticas. Build padrão Turbopack falhou ao iniciar/conectar seu processo de CSS, inclusive na repetição autorizada; não foi declarado aprovado.
- `scripts/test-dashboard-charging-flow.mjs` passou contra a API e MySQL reais locais: ocioso 0 kW → EV1 18,04 → ambos 36,08 → EV2 18,04 → ocioso 0. Resíduo do balanço zero. Ambos QR percorreram autorização Pix sandbox, início, repetição idempotente, encerramento e comprovante persistido; estado físico permaneceu não disponível.
- Três workers V3 produziram a primeira decisão válida na inicialização; serviço comercial legado iniciou separadamente. Modelos inalterados.
- Navegador automatizado: bloqueado pela política da ferramenta antes da observação; nenhuma captura ou aprovação visual desta versão foi fabricada. Teste no celular solicitado ao proprietário e ainda pendente.
- ESP32: proprietário informou que está desconectado. Nenhum ACK físico alegado; ponte restrita ao loopback.

## Prévia autorizada

IP informado e confirmado no Windows: `10.249.171.253`. Prévia: `http://10.249.171.253:3010/login`.
Use a conta existente e a senha conhecida; nenhuma senha deve ser incluída nesta documentação.

```powershell
pwsh -NoProfile -File scripts/stop-legacy-integration.ps1
pwsh -NoProfile -File scripts/start-legacy-integration.ps1 -PreviewBindIp 10.249.171.253
```

O script recusa IP não atribuído, verifica identidades/PIDs/início dos processos e preserva MySQL/volumes. Só as portas 3010/3011 são encaminhadas à LAN. Banco 3308, GIEs e ponte 3012 continuam em loopback. Nenhuma regra de firewall foi alterada. Se o IP mudar, repetir com o IP do computador autorizado. O acesso efetivo de outro dispositivo depende da conectividade da rede e do firewall.

## Plano auditado de identidade e pendências — ainda não aplicado

Auditoria: `users` tem unicidade de email, hash de senha e IDs compartilhados pelo login Web/App. Nenhuma coluna CPF; nenhuma colisão em `LOWER(TRIM(email))` nos 11 registros. Cadastro mobile valida confirmação/termos e usa bcrypt custo 12. Não copiar usuários nem trocar senhas existentes.

1. Migração aditiva de identidade: CPF opcional para contas antigas, normalização/validação de dígitos, índice único protegido com HMAC e chave privada versionada. Não armazenar CPF em logs, JWT, URLs ou respostas integrais. Não usar CPF como prova de posse ou autorização. Auditar rota de cadastro web e mobile para convergir no mesmo serviço; manter contrato anterior até coordenar o App. Não vincular visitante por email/CPF declarado.
2. Recuperação: fluxo próprio com tokens expiráveis e de uso único, sem revelar se conta existe. Não improvisar recuperação pela atribuição de CPF; nenhuma infraestrutura de email externa será acionada neste ambiente.
3. Pendências: ledger com usuário, sessão, origem, composição em centavos, eventos imutáveis de liquidação/reversão, chaves idempotentes e bloqueio transacional. Isolamento SANDBOX/operacional obrigatório. Saldo pré-pago não utilizado é crédito/restituição, nunca dívida. Na autorização seguinte, exigir apresentação e aceite explícito da composição; não liquidar automaticamente receitas fictícias.
4. Aplicar somente no clone após validar compatibilidade e backup; testar concorrência, liquidação parcial, replay, reversão, ownership e nenhuma alteração dos 65/61/45 registros. Não tornar obrigatório CPF para login legado.
5. App do colaborador: nenhuma edição local. Documentar contrato para integração quando a versão correspondente estiver disponível.

## Pendências para concluir a missão inteira

- Confirmação visual pelo proprietário no desktop/celular, QR real e capturas antes/depois. A aprovação da API não substitui esse aceite.
- Gráficos/relatórios dedicados às sessões SANDBOX atuais ainda precisam integração; não estão unidos aos datasets importados.
- Cenário Normal atual implementado no Posto; generalização coerente para os demais perfis exige suas configurações específicas. A apresentação dos outros GIEs permanece preservada.
- CPF, recuperação e ledger acima são plano, não funcionalidades entregues; nenhum patch de identidade foi aplicado.
- Refinamento mobile do CSS Web Charge após conferir o fluxo visual; CSS atual preservado nesta etapa.
- Comunicação do ESP32 real via Serial/Wi-Fi permanece pendente da placa; nenhum teste físico ou relé autorizado.
- PR deve permanecer em rascunho, sem merge/deploy e sem declarar a missão integral concluída.

## Correção local do GIE do Prédio Comercial — 2026-10-21

- Causa reproduzida: a saída das cenas comerciais em PRESENTATION não incluía `provenance.origin` e `provenance.station_id`. O Backend rejeitava a resposta pelo contrato estrito. O nome da estação não participa dessa validação.
- Correção no adaptador multie estação: copiar a decisão comercial de apresentação/manual e acrescentar os metadados da instância. Identidade/origem conflitantes continuam rejeitadas. Nenhum modelo, cálculo, cena original, CSS ou banco alterado.
- Teste unitário: 3 casos aprovados, incluindo preservação integral das 16 cenas, rejeição de identidade/origem conflitantes e ausência de mudanças nos demais perfis/modos.
- Validação ao vivo: 16 cenas passaram pelo parser real compilado do Backend; avanço de cena aprovado; estado de Posto/Residência permaneceu idêntico durante os testes comerciais.
- API autenticada: estações 13, 39, 46 e 47 online. Prédio deixado em PRESENTATION na primeira cena, com controles disponíveis. Serviço GIE V3 reiniciado; bancos preservados.
- Endereço atual: http://192.168.15.4:3010/stations/13/dashboard . Conferência visual no navegador permanece a cargo do usuário devido ao bloqueio de automação previamente registrado.

## Caixa SANDBOX do Prédio Comercial — 2026-10-21

- Prédio 13 auditado com carregadores 49/50/51 (22/60/22 kW), mantendo identidades, propriedade, visibilidade, tarifas e configuração operacional originais.
- Caixa local usa tabelas lab_charge_* e snapshots das tarifas cadastradas. Dinheiro/recebimento externo são demonstração; sem provedor externo ou comandos ESP32 para o Prédio.
- Restrição local de execução: clone 127.0.0.1:3308, instalação autorizada, vínculo COMMERCIAL/SIMULATED e permissões OPERATE verificadas. OCPP real continua obrigatório fora do caixa SANDBOX.
- Patch 0007 amplia apenas a CHECK da tabela lab_charge_sessions: EV3 permitido somente para estação 13/carregador 51. Backup verificado antes: emps_integration_pre_charging_sandbox_20261021T041549Z_27ff2d48.sql.gz; SHA256 6D3751F8303B01EC573E3DBACBE364F9835A09BC16F33FC814FAD23AFF1E033D.
- Teste de integração direto dos serviços, usando identidade existente admin.dev e verificações reais de permissão (não é teste de login no navegador): três sessões simultâneas, repetição idempotente, bloqueio de parada por outra estação, encerramento e persistência aprovados. Nenhum método da ponte física chamado. Sessões de teste permanecem identificadas como SANDBOX.
- Contagens operacionais preservadas: 65 sessões, 61 pagamentos, 45 intenções. Potência hipotética simultânea de recarga 85,28 kW, zero após encerrar; não é medição física.
- Frontend: 14 testes focados aprovados e TypeScript aprovado. Fluxo acompanha EV1/EV2/EV3 e prioriza sessões ativas do Prédio sobre as cenas de apresentação. Ao concluir, animação cessa e registros permanecem na lista de sessões SANDBOX. A hipótese de alimentação pela rede cobre somente o circuito de recarga, não o consumo completo do prédio. Nenhum CSS alterado.
- Validação visual manual pendente (automação bloqueada). Teste reproduzível: scripts/test-building-cashier.cjs após build do Backend, exclusivamente com a cópia local existente. QR/App do Prédio não foram ampliados nesta correção do caixa do Site.

## QR, visitante e notificações — 2026-10-21

- Removida a mensagem de sucesso extensa sobreposta nos cartões. Estado da sessão e erros permanecem; CSS e layout não foram alterados.
- Leitor do App permite URLs /charge/token e /c/token do IP privado configurado em EXPO_PUBLIC_EMPS_API_URL, porta 3010, apenas fora de produção. Domínios oficiais permanecem aceitos; outros IPs/rotas permanecem rejeitados. O App foi alterado apenas nesse parser e seu teste, conforme pedido específico de correção do QR.
- Prédio 13: endpoints Web Charge e Mobile usam o mesmo ledger lab_charge_* para contas/visitantes. Visitante reutiliza identidade opaca com validade e vínculo ao carregador; não cria usuário autenticável. Autorização, início, sessão ativa, parada, comprovante e cancelamento implementados sem gateway externo/ponte física. Posto privado não recebe acesso anônimo.
- Patch local 0008 aplicado somente na cópia 3308: actor_user_id nullable em intents/sessions SANDBOX, guest_id e índice/constraint de identidade em intents. Backup verificado: emps_integration_pre_charging_sandbox_20261021T043127Z_ce2bef34.sql.gz; SHA256 58CEFFA3DB26C5E64DB853E7F44467C34DD368ADAFA39ED3A8893C8619894C60.
- Testes: Backend compilado e 4 testes focados aprovados; Frontend TypeScript e 12 testes focados aprovados; leitor QR App 8 testes aprovados.
- API real local: visitantes testados nos carregadores 49,50,51 (Pix), sessões finalizadas com energia/comprovantes salvos, replay de autorização idempotente e acesso cruzado negado. Contagens antes/depois iguais: 12 usuários, 65 sessões operacionais, 61 pagamentos, 45 intenções operacionais. Nenhum usuário criado pelo fluxo visitante.
- API Mobile com conta: QR, cartão SANDBOX, início/parada/comprovante aprovados. Cancelamento Web Charge aprovado. Teste visitante reproduzível: scripts/test-building-web-guest.mjs; aborta se houver recarga ativa no carregador testado.
- Expo reiniciado (PID 43684), manifesto confirma EMPS Charge deste workspace, host 192.168.15.4:8081. Ambiente temporário EXPO_PUBLIC_EMPS_API_URL=http://192.168.15.4:3011; arquivo .env público original preservado. É necessário recarregar Expo Go e autenticar na API local caso o token anterior seja de outro ambiente.
- Verificação visual no celular ainda depende do usuário. Não realizado deploy/merge nem acesso ao banco oficial.
