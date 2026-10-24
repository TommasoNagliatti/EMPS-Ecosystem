# Limite das consultas SANDBOX

A ponte LAN TCP faz clientes chegarem ao Backend pelo mesmo IP. GET de estado usava o limite padrao de 120/min por handler/IP. Ajustado exclusivamente GET /v2/stations/:stationId/charging-sandbox para 600/min; JwtGuard e permissao de estacao mantidos. Login, START, STOP e pagamentos sem alteracoes.

Os dois pollers de SANDBOX aguardam 60s apos HTTP429, em vez de insistir a cada3s. Falha continua sendo mostrada como indisponivel, sem fingir dados atuais.

Verificado: Nest build; tsc frontend; 7 testes de cartoes; metadados do decorator confirmam somente GET alterado; resposta HTTP local confirmou X-RateLimit-Limit600. Reinicio controlado dos servicos registrados, dados MySQL preservados. Conta de teste privada recebeu403 ao tentar selecionar modo; usuario deve selecionar Demonstracao de carregadores com sua conta autorizada. Nao mudar permissoes para contornar403. Sem firmware novo, merge ou deploy.
