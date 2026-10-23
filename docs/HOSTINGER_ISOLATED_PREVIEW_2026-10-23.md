# Homologacao isolada na Hostinger — 23/10/2026

Base 778b7a3, stack emps-preview-778b7a3, pasta de release independente. Usuario aprovou preview.emps-charge.tech e seu registro DNS. Caddy recebeu somente rota adicional com validacao/reload; rotas oficiais preservadas. Sem merge, sem atualizacao do checkout oficial, sem alterar os containers existentes ou o banco oficial. Ambiente no computador nao foi parado.

Dados: schema exportado do clone local; quatro cadastros de instalacoes sanitizados, oito carregadores; conta exclusiva de teste (sem contas antigas). Historicos somente das tabelas demo: 13.285 sessoes, 7.961 pagamentos sinteticos, 104.832 leituras. Sessoes e pagamentos operacionais da previa vazios. Segredos gerados na VPS, armazenados em arquivos privados, ausentes do Git.

Rede Docker propria, banco sem porta publicada, MySQL no loopback do namespace compartilhado dos containers de homologacao. GIEs e Backend usam apenas esse namespace. Ponte ESP32 desligada. Flags de bloqueio eletrico/pagamentos externos mantidos; Stripe externo sem chaves de producao. Testes de caixa sao recibos exclusivamente simulados.

Validacoes internas: login e rejeicao anonima; cadastro, historico e analytics das quatro instalacoes HTTP200. GIE comercial V3, Posto e Residencia iniciados; Shopping no GIE legado independente. Teste de duas sessoes SANDBOX confirmou STOP EV1 preservando EV2, seguido de STOP EV2. Comparativo da rede passou. Primeira consulta excedeu limite de memoria do MySQL novo; aumentado somente o limite de homologacao de768MiB para1536MiB; nova verificacao passou e sem reinicios por17h na retomada.

A API publica da previa usa /api. Cookie de refresh recebe Path=/api/auth e Secure no proxy exclusivo de homologacao; backend original nao foi modificado. Cliente Socket.IO passa a usar a origem da URL da API, preservando namespace /realtime mesmo quando HTTP usa /api. Teste cobre previa, dominio oficial e acesso LAN.

Frontend/servicos de producao confirmados ativos por6dias na retomada. Site HTTPS oficial e previa responderam200. Nenhum dado/servico local encerrado. Navegacao automatizada indisponivel pois navegador esta desabilitado nas configuracoes Work; validacao visual manual continua pendente. Credenciais entregues por arquivo privado local, nao neste documento.

## Resultado publico
HTTPS preview.emps-charge.tech/login e /api/auth/health responderam200 com certificado valido. Login com conta exclusiva, cookie Secure/HttpOnly com Path=/api/auth e renovacao responderam200. As quatro APIs de estacao e as quatro rotas de dashboard responderam200; Socket.IO autenticado em /realtime conectou. Previa frontend atualizada para imagem64d7831. Site oficial respondeu200 apos ativacao; containers oficiais continuaram ativos sem recriacao.

Residencia no endpoint publico:42 sessoes,32 OWNER,10 VISITOR, receita simulada434.72, margem estimada276.64; lucro liquido indisponivel, conforme metodo. Comparativo publico respondeu200. Tabelas operacionais do banco da previa vazias; testes geraram e encerraram apenas sessoes SANDBOX. Credenciais geradas exclusivamente para homologacao foram salvas em arquivo privado local. Nao reutilizar senhas oficiais. Stripe externo e ponte ESP32 nao configurados nesta previa.

A ligacao do Caddy existente a rede da previa foi adicionada em runtime. Reinicio comum preserva a rede; futura recriacao do container Caddy pelo Compose oficial pode exigir reaplicar essa ligacao. Backup do Caddyfile e composicao anterior guardados na pasta privada da release. Retirada futura: remover somente o bloco preview, validar/recarregar Caddy e interromper exclusivamente a stack preview; nunca docker compose down da producao.
