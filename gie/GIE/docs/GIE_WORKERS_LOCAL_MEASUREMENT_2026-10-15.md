# GIE multiestação — medição local dos três workers (15/10/2026)

## Escopo e ambiente

Medi os processos reais `spawn` dos perfis `Commercial_HighAutonomy_V2`, `DEMO_POSTO_24H_001` e `DEMO_CASA_001` no Windows, com Python 3.12.10 do `.venv` do GIE. O instrumento `tools/measure_worker_startup.py` cria um diretório temporário dentro deste checkout, inicia os modelos versionados e encerra os próprios processos. Não escreve nos relatórios históricos ou em banco de dados. Nenhum modelo matemático ou artefato congelado foi alterado.

Comandos, a partir de `gie/GIE`:

```powershell
& .\.venv\Scripts\python.exe -B tools\measure_worker_startup.py --mode serial
& .\.venv\Scripts\python.exe -B tools\measure_worker_startup.py --mode parallel
```

O timeout foi o padrão real do `Manager`: **90 segundos por worker**. As medições fazem amostragem do working set, bytes privados e tempo de CPU dos filhos a cada 100 ms. Pequenos picos entre amostras podem escapar. Os valores de memória privada do Windows indicam compromisso privado, não RAM residente.

| Modo | Comercial | Posto | Residência | Parede total | Pico simultâneo dos três working sets | CPU acumulada dos três |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Serial | 2,438 s | 2,344 s | 3,218 s | 8,312 s | 412,4 MiB | 13,58 s |
| Paralelo | 3,859 s | 4,219 s | 3,828 s | 4,719 s | 402,5 MiB | 13,89 s |

Uma primeira medição, com cache de arquivos menos aquecido e timeout diagnóstico de 300 s, levou 11,42 s em série (5,75 / 2,84 / 2,48 s) e 3,05 s em paralelo (2,70 / 2,80 / 2,70 s). Todas as inicializações tiveram PID distinto, identidade de modelo correta e `hardware_commands_sent=false`. O maior pico individual de working set na repetição foi 156,5 MiB. Os bytes privados dos três processos ficaram em torno de 0,81–0,85 GiB cada; não se deve somá-los e interpretar o resultado como RAM física usada.

## Serviço HTTP integrado

O serviço local de teste em `127.0.0.1:8520` foi consultado com seu token local, sem expor o token nos logs. Antes do teste, os três registros estavam `stopped`. Chamadas `/initialize` levaram 2,443 s (Comercial), 2,410 s (Posto) e 4,478 s (Residência). O health seguinte confirmou três PIDs diferentes em `running`.

Um `/cycle` simultâneo pela API levou 8,80 s no Comercial, 1,51 s no Posto e 1,19 s na Residência. Todos retornaram `source=SIMULATED`, `hardware_commands_sent=false`, 48 passos de previsão e `event_feed_status=recorded`. O Posto informou duas baterias; a Residência, nenhuma. Os journals `events.jsonl` tinham exatamente um `cycle` por estação, e os snapshots mantinham a origem simulada. O stderr do Uvicorn continha somente as mensagens normais de partida; não houve erro de worker.

Depois dos ciclos, o working set medido nos três filhos foi 129,8 + 150,3 + 144,9 MiB. O processo da API acrescentou 93,1 MiB, totalizando cerca de **518 MiB residentes** para esses quatro processos naquele instante. O compromisso privado dos quatro somava cerca de 2,89 GiB. Esses números servem ao planejamento de RAM/commit da VPS; foram medidos no computador local, sem executar nada na VPS.

## Teste de isolamento e causa do bloqueio anterior

A suíte `gie_multistation.test_isolation` exerce inicialização simultânea real, ciclos simultâneos, isolamento de estações, recuperação, envelopes físicos e as 16 cenas comerciais originais. No sandbox restrito, uma chamada de loopback falhou explicitamente com `An attempt was made to access a socket in a way forbidden by its access permissions (127.0.0.1:8520)`. A suíte iniciada nesse mesmo sandbox não avançou ao primeiro caso e foi interrompida. Com acesso local a processos e sockets, a mesma suíte completou 16 casos funcionais; portanto, **não houve reprodução de falha de inicialização dos modelos**. A execução anterior de mais de 90 segundos não preservou log suficiente para provar retrospectivamente sua causa; a restrição de socket/processo é uma explicação reproduzida neste ambiente.

Na primeira execução com acesso local, o 17º caso falhou porque `reports/multistation/v1/preservation_before.json` não existe nem está versionado neste checkout. O teste agora registra um `skip` explícito somente quando esse manifesto histórico não foi distribuído; quando ele existe, todos os hashes ainda são conferidos. A repetição terminou em **28,386 s: 16 passaram, 1 foi ignorado, 0 falharam**. O único aviso foi de depreciação do `httpx` com `starlette.testclient`.

Para reproduzir a suíte em Windows, defina `PYTHONPATH` para `gie/GIE/src` e `TEMP`/`TMP` para um diretório gravável; permita processos e sockets locais. O token do serviço HTTP fica apenas no ambiente local. O teste não depende de MySQL, OCPP, pagamentos ou comandos físicos.
