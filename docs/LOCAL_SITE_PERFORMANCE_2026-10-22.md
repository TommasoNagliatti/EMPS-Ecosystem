# Site local: desempenho — 22/10/2026

## Alteração

O launcher `scripts/start-legacy-integration.ps1` agora usa `FrontendMode=Optimized` por padrão: build webpack seguido de `next start`, restrito a loopback e servido pelo proxy LAN existente. O build usa os fontes atuais e o IP solicitado, sem reutilizar URLs públicas compiladas para outro IP. Artefatos ficam em `.next-local-optimized`, ignorados no Git. Dois workers e heap de build de 2 GiB limitam a pressão de memória. CSS, componentes e regras de negócio não foram alterados nesta otimização.

O modo anterior continua disponível com `-FrontendMode Development`. Para trocar, parar somente o frontend registrado com `scripts/stop-legacy-integration.ps1 -Services frontend`, depois executar o launcher com o mesmo IP e opções locais. Não trocar o modo enquanto o frontend estiver ativo. A primeira preparação otimizada demora; depois as páginas não compilam durante a navegação. Alterações posteriores de código exigem novo build/reinício nesse modo.

## Evidências

- Antes: logs do modo dev registraram `/stations` em 7,8 s (7,6 s compilando), dashboard em 5,8 s (5,7 s compilando), login em 7,6 s. Páginas já aquecidas eram mais rápidas: login 56–325 ms e dashboard residencial 108 ms na medição inicial.
- Depois, pela LAN: login 7 ms, estações 16 ms, Prédio 73 ms, Posto 9 ms, Residência 14 ms, comparativo 16 ms, carregadores 35 ms, sessões 17 ms, pagamentos 35 ms. Todas HTTP 200. Medições pontuais do HTML, não de carregamento completo/renderização no navegador.
- Memória do processo Frontend: 1.103 MiB no dev para 102 MiB no servidor otimizado, após as nove requisições.
- Login via API local válido; leituras autenticadas: estações 46 ms, analytics residencial 655 ms, Posto 687 ms, comparativo 755 ms. O comparativo ainda retorna aproximadamente 3,87 MB de JSON; não foi alterado nesta etapa.
- Build completo com TypeScript e geração de 18 páginas concluído. Treze assets JS/CSS da página de dashboard responderam corretamente (750.262 bytes sem compressão).
- Sintaxe PowerShell e diff-check dos arquivos desta mudança aprovados. Avisos de whitespace em arquivos GIE preexistentes foram preservados.
- Automação visual bloqueada pela política de URL da ferramenta no intersticial da página local. Não houve comparação visual automatizada nem medição de Web Vitals.

## Preservação

MySQL, dados, API, GIEs, Expo, modelos e aparência preservados. Nenhum seed, migration, pagamento, comando físico, deploy ou merge. Endereço local testado: `http://192.168.15.3:3010/login`.
