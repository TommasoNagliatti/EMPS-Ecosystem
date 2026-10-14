# Site EMPS

Next.js 16 e React. O site fala com a API NestJS; nunca se conecta diretamente
ao MySQL, ao gateway de carregadores ou a uma chave secreta de pagamento.

## Executar

Siga [o guia da raiz](../../../STARTUP.md) para preparar banco e API. Dentro
desta pasta, apos instalar com `npm ci`, use `npm run dev`. O site fica em
http://localhost:3000/login. Entre com a conta criada no **seu** banco local.
O repositorio nao inclui uma senha de administrador.

`.env.example` documenta `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_EMPS_DEMO_MODE`.
Variaveis `NEXT_PUBLIC_*` entram no bundle e precisam estar corretas antes
do build. Nao coloque segredos nesses campos. Para outro dispositivo, use um
endereco de API alcancavel por ele e CORS explicitamente permitido no backend.

## Funcionalidades

- Lista e cadastro de instalacoes, mapa, temas e preferencias locais.
- Painel da instalacao, fluxo energetico, historico, clima e periodos.
- Carregadores, solicitacoes, sessoes, pagamentos, clientes e alertas.
- Autenticacao e acesso por associacao/permissao da instalacao.
- Invalidacao por Socket.IO com conciliacao REST.
- Modo remoto com indicacao de somente leitura e bloqueio de acoes de escrita.

O replay isolado do GIE nao e usado como telemetria oficial. Falhas de API e
dados ausentes devem permanecer explicitos. Referencias visuais ao SEMS+ nao
representam integracao ou autorizacao comercial da GoodWe.

## Verificar

```powershell
npm run build
npm test
```

`npm test` cobre todos os arquivos `tests/*.test.cjs`. `test:energy` continua
disponivel para a verificacao focal de energia. Consulte `AGENTS.md` antes de
alterar o codigo Next.js; use a documentacao da versao instalada.
