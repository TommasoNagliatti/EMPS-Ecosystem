# QR do Expo sem coordenadas — 24/10/2026

## Causa

As respostas dos dois QRs comerciais da prévia preservam `station.coordinates=null` e `coordinatesUnavailable=true`, pois a localização foi removida na sanitização. Ao resolver um QR, o App insere essa estação no contexto compartilhado. A tela inicial, ainda montada, calculava distâncias e criava marcadores acessando `.latitude` sem validar a ausência das coordenadas.

## Correção

- Modelo da estação admite coordenadas nulas.
- Distância ausente é identificada como indisponível; a estação permanece na lista, depois das estações com distância conhecida.
- Mapas nativo/Web não criam marcadores para coordenadas ausentes ou inválidas. Nenhuma coordenada zero ou localização fictícia foi cadastrada.
- A rota informa localização indisponível sem abrir mapas com destino inventado. O QR e o carregador continuam acessíveis.
- Layout, estilos, tarifas, pagamentos, sessões, Backend, GIE, maquete e dados na Hostinger permanecem inalterados.

## Validação

TypeScript aprovado e 17 testes focados aprovados. O teste de regressão renderiza a tela inicial e ambos os mapas com a estação sem coordenadas, reproduzindo o estado depois de resolver o QR; testa também navegação, ordenação, coordenadas inválidas e coordenadas zero válidas.

Os dois QRs da API HTTPS confirmaram localização nula intencional. Os Expos de prévia (8082) e local (8081) foram reiniciados com limpeza de cache: o modo CI anterior impedia atualizar o bundle. A configuração privada passou a `CI=false`, mantendo os respectivos destinos de API e a atualização de arquivos. Site, APIs e ponte ESP32 não foram reiniciados.

A conferência final da câmera/tela no telefone depende de recarregar o App no Expo Go e ler novamente o QR. Não é necessário regravar o ESP32 ou atualizar o servidor.
