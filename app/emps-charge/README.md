# EMPS Charge

Aplicativo do motorista em Expo SDK 57, React Native e Expo Router. Consome a
API NestJS compartilhada em `/mobile/v1`, respaldada pelo MySQL 8.

Inclui login/cadastro, mapa, localizacao opcional, consulta de eletropostos,
QR, acompanhamento de recarga, pagamento Sandbox e historico/recibos. Tokens
nativos usam SecureStore; os detalhes dos contratos estao na documentacao da
API e nos testes de `tests/`.

## Executar no celular

Prepare banco e API pelo [guia da raiz](../../STARTUP.md). Configure `.env`
a partir de `.env.example`, usando o IP da API local no computador ou um
endpoint HTTPS autorizado. `localhost` no celular aponta para o celular.

```powershell
npm ci
npx expo start --lan --clear
```

Um tunel Expo transporta o bundle, nao expoe automaticamente a API. Em outra
rede, a API tambem precisa ser alcancavel. O acesso ao banco oficial nao e
entregue a quem clona este repositorio.

O Expo Go precisa ser compativel com o SDK. Funcionalidades nativas e Stripe
podem exigir um development build; executar no navegador nao valida camera,
mapa nativo, PaymentSheet ou compartilhamento no iPhone/Android. Nao ha build
nativo publicado por esta organizacao do repositorio.

## Verificar

```powershell
npm run check
npm run export:web
```

O primeiro comando executa lint, TypeScript e testes. A exportacao web pode
ser usada para validar o bundle, mas nao substitui testes em aparelho real.
Chaves privadas e configuracoes de producao nunca devem entrar em campos
`EXPO_PUBLIC_*`.
