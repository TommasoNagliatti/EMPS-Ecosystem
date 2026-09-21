console.error('O MySQL oficial já existe. Não execute migrations PostgreSQL neste banco. Revise database/EMPS_Database_Completo.sql e use prisma validate/generate. Nenhuma alteração foi aplicada.');
process.exitCode = 1;
