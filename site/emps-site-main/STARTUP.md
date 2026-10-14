# Execucao da plataforma

O guia atual esta na [raiz do monorepo](../../STARTUP.md).
Os exemplos antigos de PostgreSQL, pasta `mobile/`, Expo SDK 54 e credenciais
fixas nao se aplicam a esta versao.

Use os lockfiles existentes e os iniciadores de `../../scripts`. Eles nao
aplicam migrations ou seeds automaticamente. O modo local usa seu MySQL local;
o [modo remoto de leitura](../../docs/REMOTE_DEVELOPMENT_HOSTINGER.md) exige
autorizacao e configuracao privadas independentes.
