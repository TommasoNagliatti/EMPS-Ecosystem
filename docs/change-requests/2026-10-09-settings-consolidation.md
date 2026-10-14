# Centralização das configurações

Data: 09/10/2026. Projeto: EMPS-Ecosystem-2026-10-07.
Estado: implementado e validado localmente; aprovação do grupo pendente.
Sem commit, push ou deploy. Alterações anteriores preservadas.

## Solicitação

Retirar Configuracoes EMPS da navegação lateral. No menu superior direito do perfil, renomear Configurações do site para Configurações e reunir tema e demais configurações na mesma área.

## Resultado

- O módulo EMPS da lateral não contém mais o link de configurações, tanto no menu expandido quanto no pop-up compacto e na navegação móvel.
- O menu do perfil possui Configurações e mantém atalhos para Meu perfil, Minha conta e Senha e segurança; todos usam a mesma central em `/settings`.
- O seletor de tema não fica mais duplicado dentro do pop-up do perfil. Está em Configurações > Aparência, primeira seção aberta por padrão. O mecanismo existente continua aplicando e salvando a preferência localmente para site e mapa.
- A central reúne Aparência, Meu perfil, Minha conta, Senha e segurança e Administradores. A última seção só aparece para perfil admin; abrir sua URL com perfil ausente ou não administrativo mostra Aparência, sem montar o formulário.
- O cadastro de administradores foi mantido com o componente e endpoint já existentes. Mudou apenas sua apresentação e posição na interface; sua própria verificação de permissão continua ativa.
- Os seis antigos cards Fonte de dados, Autenticacao, SEMS+, Status canonicos, Moeda e energia e Tempo real foram retirados da página. Eram descrições técnicas estáticas, não controles editáveis. Não foi desativada nenhuma integração ou regra descrita por esses cards.
- Links antigos `/account?tab=...` redirecionam para a seção equivalente em `/settings?tab=...`. Parâmetros não reconhecidos são tratados por listas permitidas, sem redirecionamento para destinos externos.

## Inventário exato

Caminhos relativos a `site/emps-site-main/frontend`. Oito arquivos de implementação e um de testes alterados:

1. `components/shell/shell-navigation.ts`: remove o item Configuracoes EMPS e seu import Settings; preserva todos os demais destinos e os links de integração SEMS+.
2. `components/account/ProfileMenu.tsx`: renomeia Configurações do site; troca atalhos pessoais por URLs `/settings?tab=...`; remove o atalho separado Aparência e o seletor de tema duplicado, com seus imports. Identidade, animação, fechamento e logout preservados.
3. `components/account/account-model.ts`: acrescenta SettingsTab, settingsTabs e settingsTab. Seções permitidas da central com padrão appearance; mantém AccountTab/accountTab para compatibilidade e não altera a projeção da sessão ou credenciais.
4. `components/account/AccountSettings.tsx`: passa a atender a central, com título Configurações e links canônicos. Aparência vem primeiro; acrescenta a seção Administradores filtrada por perfil e monta CreateAdminForm apenas quando essa seção é permitida. Preserva formulários pessoais e salvamento indisponível. Não adiciona chamadas de escrita.
5. `components/account/account-settings.module.css`: acrescenta estilos locais do formulário administrativo: título, texto, campos, botão, estado ocupado, foco e mensagem. Campos em 16 px; layout sem card técnico flutuante. Estilos anteriores de conta e aparência preservados.
6. `components/operations/CreateAdminForm.tsx`: recebe className opcional, com setting-card como padrão. Troca somente a classe do contêiner para permitir o layout da central. Verificação de admin, endpoint, validações, bloqueio de envio duplicado, estados de sucesso/erro e limpeza do formulário não foram alterados.
7. `app/settings/page.tsx`: substitui grade técnica e renderização direta do formulário pela central AccountSettings. Lê searchParams de forma assíncrona e valida tab com settingsTab; não altera variáveis de ambiente.
8. `app/account/page.tsx`: mantém validação accountTab e redireciona a rota antiga com redirect do Next.js para `/settings?tab=...`.
9. `tests/account-theme.test.cjs`: ajusta a verificação da lateral e do menu à nova navegação. Acrescenta quatro testes: validação de parâmetros da central, links e seleção única, restrição administrativa por perfil, compatibilidade de URLs antigas. Usa perfis simulados apenas nos testes, sem sessão real ou escrita no banco.

## Funcionalidade e limites

- Tema claro/escuro: funcional, com a mesma persistência e sincronização local já existentes. Não foi criado serviço de preferências no backend.
- Administradores: função anterior preservada. A conferência desta entrega não preencheu senhas nem enviou cadastro; nenhuma conta foi criada.
- Perfil, conta e senha: a interface anterior continua mostrando Em breve e salvamento desabilitado. Não foi implementada edição real de perfil ou alteração de credenciais.
- A ocultação do formulário no frontend não substitui a autorização do backend. A autorização existente não foi modificada ou ampliada.
- A aplicação do tema ao mapa permanece no mecanismo já existente; o mapa não foi reaberto nesta conferência. Os testes anteriores do mapa em ambos os temas continuaram aprovados.

## Verificação

- `node --test tests/*.test.cjs`: 97 testes aprovados, zero falhas. Quatro testes novos além dos 93 anteriores.
- `npm run build`: compilação, TypeScript e geração das rotas concluídos. `/settings` é dinâmico por consultar parâmetros; `/account` permanece dinâmico e compatível.
- Navegador: menu superior direito com Configurações, sem seletor duplicado; seção Aparência; troca claro/escuro e persistência após recarga; antigo `/account?tab=appearance` chega a `/settings?tab=appearance`.
- Conferidos pop-up lateral sem link de configurações, área administrativa para a sessão admin atual e seção de segurança com salvamento desabilitado.
- Viewport 390 x 844: página sem overflow horizontal; apenas a barra de seções tem rolagem própria. Campos administrativos com 16 px e largura de 352 px dentro do conteúdo. Viewport temporário removido e tema escuro restaurado.
- Sem erros de console na conferência final. Página de Configurações mantida aberta para revisão.
- Revisão React: composição reutilizada, nenhum novo hook global, parâmetros permitidos, seção administrativa filtrada e chave do perfil preservada nos campos pessoais.

## Fora do escopo / preservado

Backend Nest.js, MySQL, GIE, aplicativo móvel, imagem, cabos, histórico, cálculos, tarifas, autenticação, permissões, senhas, migrações e cadastros não foram alterados nesta entrega. Não houve chamadas de cadastro ou escrita no banco durante a validação. Não foram adicionadas dependências ou variáveis de ambiente.

O workspace já tinha alterações anteriores, inclusive no backend; elas foram preservadas, não fazem parte desta entrega e não foram revertidas.

## Documentação e capturas

PDF: `output/pdf/EMPS_ALTERACAO_CONFIGURACOES_2026-10-09.pdf`.
Gerador local: `tmp/pdfs/build-settings-report.py` (apoio documental, não faz parte do código executado pelo site).

Capturas mantidas no arquivo local privado de evidencias:

- `emps-settings-before-20261009.jpg`: página anterior, somente leitura.
- `emps-settings-final-20261009.jpg`: central em tema escuro.
- `emps-settings-profile-menu-20261009.jpg`: acesso pelo menu do perfil.
- `emps-settings-light-20261009.jpg`: tema claro.
- `emps-settings-sidebar-20261009.jpg`: módulo EMPS sem configurações na lateral.
- `emps-settings-administration-20261009.jpg`: formulário administrativo sem preenchimento.
- `emps-settings-mobile-20261009.jpg`: aparência no celular.
- `emps-settings-administration-mobile-20261009.jpg`: administradores no celular.

Aprovação: ____________________  Responsável: ____________________  Data: ____________________
