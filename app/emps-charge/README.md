# EMPS Charge — Android e iOS

Aplicativo do motorista para localizar eletropostos, ler o QR da vaga, escolher o pagamento, iniciar uma recarga e acompanhar consumo, tempo, custo e histórico.

O projeto usa Expo SDK 57, React Native e Expo Router, compatível com o Expo Go atual. O modo conectado consome a API NestJS compartilhada em `/mobile/v1`. O modo demonstração existe, mas só entra em ação quando é habilitado explicitamente.

## O que está integrado

- login e cadastro pela API, access token curto e refresh token rotativo;
- armazenamento seguro dos tokens no Keychain/Keystore por Expo SecureStore;
- eletropostos próximos, carregadores, status, potência e tarifa vindos do PostgreSQL;
- localização foreground opcional;
- mapa interativo com MapLibre e tiles vetoriais do OpenFreeMap baseados no OpenStreetMap;
- câmera para QR e alternativa por código digitado;
- resolução do QR no backend antes de qualquer liberação;
- intenção de pagamento idempotente;
- início e encerramento pela API, com invalidação em tempo real via Socket.IO e polling REST de 5 segundos como fallback;
- sessão ativa recuperável, recibo e histórico sincronizado;
- deep links `https://app.emps.com.br/c/...` e `emps://charger/...`.

## Executar em um celular físico

### 1. Inicie banco e API

Na raiz do monorepo, em um PowerShell:

```powershell
docker compose up -d
Set-Location backend
Copy-Item .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run prisma:seed
npm run start:dev
```

Confirme no computador:

```powershell
Invoke-RestMethod http://localhost:3001/auth/health
```

### 2. Descubra o endereço do computador

```powershell
ipconfig
```

Use o endereço `IPv4` do adaptador Wi-Fi ativo, indicado como `IP_DA_REDE`. O computador e o celular devem estar na mesma rede. Libere o Node.js e a porta `3001` no Firewall do Windows para redes privadas.

### 3. Configure o app

Em outro PowerShell:

```powershell
Set-Location mobile
Copy-Item .env.example .env
npm install
```

Edite `.env`:

```dotenv
EXPO_PUBLIC_EMPS_API_URL=https://api.emps-charge.tech
EXPO_PUBLIC_EMPS_DEMO_MODE=false
```

> Nunca use `localhost` em `EXPO_PUBLIC_EMPS_API_URL` ao testar num celular físico. Nesse aparelho, `localhost` é o próprio Android/iPhone, não o computador que executa a API.

### 4. Abra no Expo Go

Instale ou atualize o Expo Go pela loja e execute:

```powershell
npx expo start --lan --clear
```

Leia o QR do terminal com o Expo Go. Se a rede bloquear a conexão com o Metro, tente:

```powershell
npx expo start --tunnel --clear
```

O túnel do Expo expõe somente o bundle do app. Ele não expõe a API NestJS. Nesse modo, mantenha o celular na mesma LAN para acessar `http://IP:3001` ou exponha também o backend por um túnel HTTPS e use essa URL em `EXPO_PUBLIC_EMPS_API_URL`.

Se o Expo Go informar incompatibilidade, atualize-o. Para um SDK que ainda não esteja disponível no Expo Go da loja, gere um development build/preview com EAS em vez de tentar abrir um projeto de SDK diferente.

## Credenciais e QR de teste

Após executar o seed do backend, o modo conectado aceita:

```text
E-mail: motorista@emps.com
Senha:  emps123
```

Código para digitar manualmente:

```text
EMPS-PAULISTA-A01
```

Token e link do mesmo QR:

```text
paulista-a01-demo
https://app.emps.com.br/c/paulista-a01-demo
```

Abra a imagem abaixo em outra tela ou imprima para testar a câmera:

![QR de teste EMPS Paulista A01](docs/qr/emps-paulista-a01.png)

O QR exibido pelo terminal do Expo contém um endereço `exp://` e serve somente para abrir o aplicativo. Ele não representa um carregador EMPS.

## OpenFreeMap e OpenStreetMap

No Android, iOS e navegador, o mapa carrega MapLibre GL com o estilo vetorial público do OpenFreeMap, baseado nos dados do OpenStreetMap:

```text
https://tiles.openfreemap.org/styles/liberty
```

Não há chave, conta ou cartão de faturamento. As atribuições ao OpenFreeMap e ao OpenStreetMap são exibidas no mapa. É necessário acesso à internet para baixar o MapLibre e os tiles; os marcadores ainda dependem da API EMPS, pois o mapa-base não fornece a disponibilidade dos carregadores.

O serviço público não oferece SLA. Para uma publicação comercial que exija garantia de disponibilidade, use um provedor com SLA ou infraestrutura própria, preservando as atribuições.

O botão “Como chegar” abre Apple Maps no iOS ou Google Maps no Android. Isso é separado do mapa-base e não exige chave dentro do aplicativo.

## Modo demonstração explícito

Para apresentar o aplicativo sem banco e sem API:

```dotenv
EXPO_PUBLIC_EMPS_DEMO_MODE=true
```

Depois reinicie com:

```powershell
npx expo start --clear
```

Com `false` ou com a variável ausente, o app não troca silenciosamente para mocks. Erros de URL, rede, autenticação e backend são mostrados ao usuário.

## Diagnóstico rápido de rede

No computador, substitua o IP pelo endereço real:

```powershell
Test-NetConnection IP_DA_REDE -Port 3001
Invoke-RestMethod http://IP_DA_REDE:3001/auth/health
```

Se o app abrir, mas login e eletropostos falharem:

1. confirme que `EXPO_PUBLIC_EMPS_DEMO_MODE=false`;
2. confirme que o backend continua aberto na porta `3001`;
3. confira o IP em `mobile/.env` e reinicie o Expo com `--clear`;
4. teste a URL pelo navegador do próprio celular;
5. desative temporariamente VPN/rede de convidados ou permita a conexão no Firewall;
6. não substitua o IP por `localhost`.

Se o mapa ficar em branco, confirme que o celular tem internet e consegue acessar `https://tiles.openfreemap.org`. Uma rede corporativa pode bloquear o CDN do MapLibre ou os tiles.

O cliente realtime usa o namespace `${EXPO_PUBLIC_EMPS_API_URL}/realtime`, envia o access token no handshake e escuta `emps:change`. Se o WebSocket for bloqueado, a tela de recarga consulta a API REST a cada cinco segundos e mostra discretamente que está reconectando. Com o canal ao vivo, a conferência periódica da recarga é reduzida para 30 segundos. O contexto confere sessões a cada 60 segundos conectado ou 15 segundos desconectado; entidades de mapa já armazenadas são revistas a cada cinco minutos.

## Verificações e builds

```powershell
npm run check
npm run export
```

O primeiro comando executa lint, TypeScript e testes. O segundo exporta Android, iOS e a versão web em `dist/`.

Para gerar um APK interno:

```powershell
npx eas-cli login
npx eas-cli build --platform android --profile preview
```

Para iOS a partir do Windows, use o EAS Build:

```powershell
npx eas-cli build --platform ios --profile preview
```

Antes de publicar, associe o projeto à conta Expo/EAS, configure as credenciais das lojas, defina a URL HTTPS de produção da API e valide os deep links do domínio.

## Limites das integrações externas

O fluxo local usa pagamento e OCPP em sandbox. Para cobrar dinheiro de verdade, o backend precisa de credenciais Stripe, webhook assinado e integração do método de pagamento no cliente. Para liberar uma bomba física, precisa de um CSMS/gateway OCPP configurado e compatível com o equipamento.

Nenhum desses serviços é substituído pelo mapa ou pelo QR. Consulte `INTEGRATION.md` para o contrato e `../backend/README.md` para as variáveis do servidor.
