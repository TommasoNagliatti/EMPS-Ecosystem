# Relés comerciais sem comando — 24/10/2026

## Diagnóstico

O usuário confirmou IN1/IN2 em GPIO18/GPIO19, alimentação 5 V/GND e LOW=acionado/HIGH=desligado. Esses parâmetros já estavam no sketch privado. A API autenticada mostrava aprovação USB vigente e transporte com ACK, mas decisão GIE ausente após mudança de modo, `valid=false`, `gieAuthorized=false` e `effectiveRelay=false`. No instante auditado, também não havia sessões ativas nos dois códigos comerciais. Não houve inversão de pinagem ou liberação forçada de GPIO.

No worker comercial, `set_mode('NORMAL')` limpa a decisão. O backend traduz CHARGER_DEMO para NORMAL, mas não inicializava um ciclo. Além disso, `/cycle {}` comercial reutiliza o instante padrão; depois do primeiro ciclo, o worker o recusa como replay. Posto/Residência têm outro mecanismo de avanço, preservado.

## Correção no cliente EMPS

- CHARGER_DEMO reutiliza uma decisão NORMAL existente, sem resetar o modo nativo, repetir ciclos ou alterar a alocação. O overlay continua identificado como ilustração.
- Ao voltar de outro modo ou encontrar decisão ausente, executa exatamente um ciclo nativo para inicializar o GIE, usando o instante seguinte de 15 minutos do histórico SIMULATED do próprio worker. O primeiro ciclo sem histórico mantém o default nativo. Nunca usa a data atual para reescrever datas do dataset.
- O botão de ciclo comercial também utiliza esse próximo instante, sem replay. Nenhuma entrada energética foi fabricada, modelo retreinado ou algoritmo alterado.
- Falha não é repetida automaticamente e não promove decisão inviável a válida. Cache anterior é invalidado quando há mutação/falha. O retorno confirma geração e revisão após drenar leituras anteriores em andamento.
- O JSON informa motivos específicos: GIE inválido/offline, cenas, sessão ausente, autorização operacional ausente ou EVSE não autorizado. Hardware continua exigindo aprovação privada, conexão, sessão válida e decisão GIE autorizada.
- O handshake registra a versão diagnóstica USB quando a placa anuncia essa capacidade; não equivale a medição física.

## Evidência e limites

Um ciclo nativo com o instante seguinte já presente no dataset comercial recuperou decisão válida. O ESP32 real passou a confirmar `accepted=true`, `valid=true`, sem erros, com autorização GIE para EV1/EV2. Sem sessão ativa, ambos permaneceram desligados, como exigido. Não foram criadas sessões nem emitidos comandos manuais de relé pela automação.

Build NestJS e 40 testes de GIE/modos/USB/energia passaram, incluindo preservação da decisão ao reselecionar modo, inicialização única, cronologia original, falha sem retry e não promoção de decisão inviável. O teste elétrico depende de iniciar a sessão no Site/App e conferir o ACK/GPIO e o módulo físico. A confirmação do software nunca comprova tensão/corrente no módulo.

Não é necessário regravar para esta correção de backend se a placa já utiliza o último sketch USB com os novos padrões de LEDs. Aprovação USB temporária continua com o prazo anterior, sem renovação automática.

## Teste posterior com sessão iniciada pelo usuário

Após o usuário iniciar EV1, o JSON real confirmou `valid=true`, `gieAuthorized=true`, `sessionAuthorized=true`, `operationalAuthorized=true`, `effectiveRelay=true`, sem motivo de bloqueio. O ACK da placa confirmou `accepted=true`, `ev1=true`, `ev2=false`. Apesar disso, o usuário relatou que o módulo físico não acionou. Portanto, o caminho lógico GIE/backend/ESP32 foi confirmado para esse START, mas o acionamento elétrico não foi comprovado. Foi solicitada a indicação do LED/clique do módulo e das linhas `[USB]` do Serial para distinguir saída de GPIO, alimentação e contatos. Não houve inversão aleatória de polaridade nem comando manual para contornar as travas.
