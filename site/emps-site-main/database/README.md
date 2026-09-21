# Banco EMPS

`Emps_DataBase.mysql.sql` preserva o esquema MySQL 8 recebido como referência do
domínio. A aplicação já utilizava NestJS, Prisma e PostgreSQL; por isso, o esquema
executável permanece em `backend/prisma/schema.prisma` e nas migrations Prisma.

Essa tradução evita manter dois bancos diferentes e conserva as entidades do SQL
original: usuários, eletropostos, carregadores e status ao vivo. A migration de
integração acrescenta os elementos exigidos pelo aplicativo: vínculo de QR,
refresh tokens, intenção de pagamento, comandos OCPP e sessões idempotentes.

Valores monetários e energia usam tipos decimais; senhas e refresh tokens são
persistidos somente como hash. Chaves estrangeiras e consultas operacionais têm
índices dedicados.
