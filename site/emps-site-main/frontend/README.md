# EMPS Frontend

Painel administrativo em Next.js 16 e React conectado à mesma API NestJS e ao mesmo PostgreSQL usados pelo aplicativo EMPS Charge.

## Executar com dados reais

Inicie PostgreSQL, migrations, seed e backend conforme `../backend/README.md`. Depois, nesta pasta, use o Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Abra `http://localhost:3000/login` e entre com o administrador criado pelo seed:

```text
E-mail: admin@emps.com
Senha:  admin123
```

Configuração padrão:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_EMPS_DEMO_MODE=false
```

As variáveis `NEXT_PUBLIC_*` são incorporadas no bundle do Next.js. Altere-as antes do build e reinicie o servidor depois de qualquer mudança.

Se o painel for aberto em outro computador ou celular da rede, `localhost` não encontrará a API. Nesse caso, use o IPv4 do computador que executa o backend:

```dotenv
NEXT_PUBLIC_API_URL=http://IP_DA_REDE:3001
```

Também inclua a origem do painel em `backend/.env`, por exemplo `CORS_ORIGINS="http://localhost:3000,http://IP_DA_REDE:3000"`.

## Integração

O login chama `POST /auth/login`. O JWT e os dados mínimos do usuário ficam em `sessionStorage` e seguem como `Authorization: Bearer <token>`. Uma resposta `401` encerra a sessão local e retorna ao login.

O painel busca na API:

- resumo do dashboard;
- clientes;
- carregadores e status ao vivo;
- sessões de recarga;
- pagamentos;
- alertas.

As ações operacionais também passam pela API: sincronização e comando do carregador, liberação manual, sessão pós-paga em dinheiro, encerramento de sessão, aprovação de pagamento e resolução de alerta. O frontend nunca acessa PostgreSQL, Stripe ou OCPP diretamente.

## Sincronização em tempo real

No modo conectado, o painel abre o namespace Socket.IO `${NEXT_PUBLIC_API_URL}/realtime` com o mesmo JWT do login. Ao receber `emps:change`, atualiza pela API REST somente as telas afetadas; o conteúdo do evento nunca substitui diretamente os dados oficiais.

O topo mostra `Ao vivo`, `Conectando` ou `Reconectando`. Cada conexão e reconexão dispara uma conciliação REST para recuperar alterações ocorridas durante a queda. O painel faz ainda uma conferência de segurança a cada 60 segundos; se o WebSocket estiver indisponível, tenta reconectar automaticamente e reduz esse intervalo para 15 segundos. O modo demonstração permanece isolado e não abre conexão realtime.

A camada em `services/` converte o contrato da API e os enums Prisma para os status exibidos em português. Se a API falhar, a tela mostra o erro; ela não substitui dados reais por mocks.

## Modo demonstração explícito

Os mocks locais só são ativados quando solicitado:

```dotenv
NEXT_PUBLIC_EMPS_DEMO_MODE=true
```

Nesse modo isolado, o login aceita um e-mail com formato válido e senha com pelo menos seis caracteres. Ele serve para revisar a interface e não compartilha estado com o banco, o aplicativo, pagamento ou carregador.

Com a variável ausente ou diferente de `true`, o painel usa exclusivamente a API configurada.

## Organização

- `app/`: rotas do App Router e layout global;
- `components/dashboard/`: métricas e visão operacional;
- `components/chargers/`: carregadores e ações;
- `components/operations/`: listas, filtros e operações;
- `components/shell/`: navegação e estrutura da interface;
- `data/mock/`: dados exclusivos do modo demonstração;
- `domain/`: tipos do contrato EMPS;
- `services/`: autenticação, cliente HTTP e mapeadores;
- `styles/`: estilos por área;
- `utils/`: formatadores.

O OpenStreetMap é usado pelo mapa do aplicativo móvel. O painel recebe localização e dados do eletroposto pela API, sem incluir chaves ou segredos de mapa.

## Produção e verificação

```powershell
npm run build
npm run start
```

Em produção:

- configure `NEXT_PUBLIC_API_URL` com a URL HTTPS pública do backend;
- mantenha `NEXT_PUBLIC_EMPS_DEMO_MODE=false`;
- adicione o domínio do painel a `CORS_ORIGINS`;
- não coloque chaves Stripe, tokens OCPP ou credenciais de banco em variáveis `NEXT_PUBLIC_*`;
- troque as credenciais do seed.

Pagamento real e liberação física dependem dos adaptadores configurados no backend; a interface, sozinha, não movimenta dinheiro nem controla uma bomba.
