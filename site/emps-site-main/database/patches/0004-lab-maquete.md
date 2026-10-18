# Patch 0004 — maquete USB local

Este patch é **exclusivo da cópia descartável `emps_integration_test` em `127.0.0.1:3308`**. Não deve ser aplicado ao `emps_db` original (3306), ao banco demonstrativo (3307) nem ao MySQL oficial. A publicação futura precisará de avaliação e aprovação próprias. O commit revisado deve ser registrado no recibo da PR antes de qualquer aplicação fora da cópia local.

- SQL: `0004-lab-maquete.sql`; SHA-256: `910c79d75c9c2e57582fa7dd749396bd759c9197bd861b1737c3888ab19607dd`.
- Estruturas novas: `lab_devices`, `lab_device_commands`, `lab_device_events`, `lab_rfid_tags`. Nenhuma tabela operacional ou demonstrativa anterior é alterada.
- Vínculo `maquete-01` → estação 46 exige inserção explícita e verificação de identidade da cópia; o patch não cria dispositivos automaticamente.
- Índices: chaves primárias; unicidade do dispositivo, da estação, da chave de idempotência por dispositivo e do hash RFID; filas e auditoria por dispositivo/tempo. O volume esperado é pequeno. Há quatro `CREATE TABLE` aditivos, sem reescrita de tabelas antigas.
- Integridade: FKs restringem vínculo de estação e deleção do dispositivo; `(device_id,station_id)` nas três tabelas filhas impede troca implícita de estação. `CHECK` valida EV1/EV2 e status de comando.
- Dados antigos: contagens de `charging_sessions`, `payments` e `payment_intents` devem ser conferidas antes/depois; comandos USB não criam registros nessas tabelas.
- Pré-condições: backup completo verificável da cópia 3308, MySQL 8, estação 46 existente, `EMPS_PHYSICAL_COMMANDS_ENABLED=false`, pagamentos externos desabilitados, OCPP ausente, conta de banco restrita à cópia.
- Aplicação parcial: interromper o Backend de laboratório, conferir as quatro tabelas e seu esquema, concluir somente as estruturas ausentes após nova revisão. Não executar automaticamente `DROP TABLE` nem restaurar a cópia por cima sem avaliar os eventos locais gerados após o backup.
- Correção/retirada: desligar `EMPS_MAQUETE_LAB_ENABLED`; essa ação bloqueia imediatamente os endpoints. O firmware mantém seu desligamento seguro local. Preservar tabelas/auditoria até uma decisão explícita de limpeza da cópia.

O ID da tag RC522 é armazenado somente como HMAC; ele pode ser clonado e serve apenas à mensagem demonstrativa no LCD. A autorização de cada relé depende de comando separado, confirmado e válido.
