# Padrões de LEDs — 23/10/2026

Alteração restrita ao firmware da montagem comercial; sem mudanças de pinagem, backend, modelos GIE, financeiro ou visual do Site.

- Poste/rede: enquanto houver importação válida, permanece aceso, com duas interrupções de 100 ms a cada cinco segundos, separadas por 100 ms aceso.
- Solar: enquanto houver geração válida, acende por 2,1 s e apaga por 1,1 s; cadência independente do poste.
- EV1/EV2: verde fixo quando disponível; vermelho fixo durante sessão autorizada. Em cenas, a indicação mantém a alocação visual existente, sem autorizar relés.
- Prédio: continua sempre iluminado. Bateria: mantém o padrão anterior de barras completas acesas e próxima barra pulsando, conforme SoC válido.

Sem uma fonte energética válida ou ilustração explicitamente válida, seus LEDs continuam desligados. Os efeitos não inventam geração, importação, sessão ou medição.

A atualização dos indicadores passou de 450 ms para 20 ms para representar os dois flashes de 100 ms sem delay bloqueante. Foi removida uma chamada incondicional a `manterRelesDesligados()` de dentro de `atualizarLuzes()`: ela interrompia as saídas a cada atualização visual. O controlador independente de relés continua sendo a única autoridade de acionamento por sessão, e `invalidar()` mantém a parada imediata nas falhas. A aprovação USB, prazos e demais travas permanecem iguais.

Há verificações de bordas, cadências, ausência de fonte e periodicidade por static_assert em `indicadores.h`, além das travas existentes de relés em `reles_usb.h`, executadas na compilação Arduino. A cadência visual e as cores ainda precisam ser conferidas pelo usuário na placa real.

Sketch local atualizado: `C:\goodwill_ai\EMPS_BACKUPS\ESP32_GIE_USB\ESP32_GIE_USB.ino`. Cópia anterior preservada em pasta `ESP32_GIE_USB_antes_LEDs_*`, incluindo header privado. Wi-Fi/token não foram publicados nem modificados. Reabrir o sketch na IDE e gravar novamente; nenhum upload automático foi executado.
