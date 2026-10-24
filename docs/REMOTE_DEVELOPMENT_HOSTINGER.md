# Desenvolvimento remoto somente leitura

O modo remoto executa site e API no PC e consulta MySQL por SSH. Ele nao usa
uma copia do banco: se configurado pelo administrador, consulta o servidor
oficial. O clone publico nao contem essa configuracao nem autoriza seu acesso.

```text
PC -> site local:3010 -> API local:3011 -> tunel SSH local:3317 -> MySQL autorizado
```

## Pre-requisitos individuais

O administrador deve aprovar uma chave SSH individual limitada ao tunel,
conferir a chave do host por canal confiavel e fornecer uma conta SQL com
somente SELECT. Identidade do servidor, endpoint privado e contas permitidas
devem ser auditados antes de preencher `.env.remote`. Nao aceite um destino
novo automaticamente para contornar uma falha.

Use `site/emps-site-main/backend/.env.remote.example` como referencia. O modelo
e deliberadamente incompleto. Configure `.env.remote` e SSH em arquivos privados
fora do controle de versao. Nao compartilhe a configuracao individual de outro PC.

## Execucao

Com dependencias instaladas e acesso previamente autorizado:

```powershell
.\scripts\start-remote-dev.ps1 -Optimized
.\scripts\check-remote-dev.ps1
.\scripts\stop-remote-dev.ps1
```

O iniciador verifica grants de leitura, identidade fixa do servidor, schema
Prisma e contas previamente autorizadas. Mantem os servidores em loopback,
bloqueia escrita operacional, jobs, pagamentos externos e comandos fisicos.
Nao aplica migrations, seeds, deploy ou alteracoes no banco.

Refresh tokens do login remoto sao locais e em memoria. Reiniciar a API
invalida essa renovacao; pode ser necessario autenticar novamente. Os hashes
de senha existentes nao sao expostos nem alterados.

## Replay GIE isolado

O modelo permite habilitar `EMPS_LOCAL_GIE_DEMO` com instalacao autorizada e
token separado. O replay representa EVSEs virtuais e nao comandos de equipamentos.
E servido apenas em loopback e fica distinto da telemetria oficial. Nao
interprete os dados de uma simulacao como historico ou faturamento real.

Os helpers administrativos personalizados de provisionamento, auditorias da
VPS e configuracoes ja entregues a outro PC nao sao distribuidos aqui. Um novo
acesso depende do administrador, nao de copiar senha, chave ou token.
