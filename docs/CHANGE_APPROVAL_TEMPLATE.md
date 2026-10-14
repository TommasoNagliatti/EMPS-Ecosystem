# Registro e aprovação de alteração

Use uma cópia deste modelo para **cada** mudança, em `docs/change-requests/CR-AAAA-MM-DD-NNN.md`. Não misture pedidos independentes no mesmo registro. Preencha a proposta antes de alterar código e complete o resultado após a implementação. Campos sem impacto devem dizer **Não se aplica**, nunca ficar em branco. Este documento não substitui o diff, os testes ou a revisão do grupo.

## Regras de aprovação

1. **Antes de mexer:** descrever escopo, comportamento esperado, arquivos prováveis, riscos e critérios de aceite. A implementação só começa depois da autorização explícita para essa proposta.
2. **Depois de mexer:** listar **todos** os arquivos criados, editados, removidos ou gerados e descrever **cada mudança de comportamento**, inclusive configurações, dependências, banco, API, interface, testes e documentação. Anexar o diff completo ou link do Pull Request para revisão linha por linha.
3. **Antes de integrar/publicar:** atualizar resultados de teste, riscos remanescentes e plano de reversão. Registrar a decisão de **cada integrante exigido** pelo grupo. Silêncio não é aprovação; aprovação parcial não libera merge nem deploy.
4. Commit, push, merge, migração de banco e deploy não são automáticos. Cada ação deve ser solicitada explicitamente; merge e deploy exigem a aprovação final de todos os integrantes definidos para a mudança.
5. Não registrar senhas, tokens, chaves, dados pessoais, dumps ou valores de `.env` neste documento. Informar apenas o **nome** da variável e a finalidade da alteração.

## Identificação

| Campo | Preencher |
| --- | --- |
| ID | `CR-AAAA-MM-DD-NNN` |
| Título curto | `[título]` |
| Solicitante | `[nome]` |
| Responsável técnico | `[nome]` |
| Data e hora da proposta | `[AAAA-MM-DD HH:MM, fuso]` |
| Repositório, branch e commit-base | `[URL, branch, SHA]` |
| Ambiente-alvo | `[local / homologação / produção]` |
| Estado | `Rascunho / Aguardando aprovação do escopo / Autorizado para implementar / Em execução / Aguardando aprovação final / Aprovado / Publicado / Cancelado` |

## 1. Proposta antes do código

### Motivo e resultado esperado

- Problema ou necessidade: `[descrever]`
- Comportamento atual: `[descrever com evidência]`
- Comportamento esperado: `[descrever de modo observável]`
- Fora do escopo: `[descrever]`
- Critérios de aceite: `[lista verificável]`

### Impacto previsto

| Área | Impacto previsto e arquivos prováveis |
| --- | --- |
| Site/interface | `[páginas, componentes, estilos, estados]` |
| Backend/API | `[rotas, contratos, regras, permissões]` |
| App/Web Charge/GIE | `[integrações afetadas]` |
| Banco e dados | `[schema, migration, compatibilidade, backup]` |
| Pagamentos/segurança | `[valores, autorização, privacidade, riscos]` |
| Infraestrutura | `[variáveis, DNS, proxy, deploy]` |
| Testes/documentação | `[casos a incluir ou atualizar]` |

### Aprovação do escopo

Quem precisa aprovar: `[lista nominal definida pelo responsável do grupo]`.

| Integrante | Decisão (`Aprovado`/`Revisar`/`Rejeitado`) | Data e evidência da decisão |
| --- | --- | --- |
| `[nome 1]` | `Pendente` | `[link ou registro]` |
| `[nome 2]` | `Pendente` | `[link ou registro]` |

**Autorização para implementar:** `Pendente`. Não iniciar alterações no produto enquanto esta etapa não estiver autorizada.

## 2. Registro completo da implementação

Preencher somente após a autorização acima. Comparar a lista abaixo com `git status` e com o diff final. Incluir alterações indiretas e arquivos gerados; indicar quando um arquivo foi alterado pelo ambiente e **não** por esta mudança.

| Arquivo (caminho completo no repositório) | Tipo (`criado`/`editado`/`removido`/`gerado`) | Linhas/funções/rotas afetadas | Antes -> depois, detalhadamente | Motivo |
| --- | --- | --- | --- | --- |
| `[caminho]` | `[tipo]` | `[referências]` | `[descrição exata]` | `[motivo]` |

### Contratos e efeitos

- Interface e experiência do usuário: `[todas as mudanças, telas, textos, estados e responsividade]`
- API e tempo real: `[rotas, métodos, payloads, respostas, eventos, compatibilidade]`
- Regras de negócio e permissões: `[todas as regras alteradas]`
- Dados e banco: `[tabelas, colunas, migrations, backfill, preservação de histórico]`
- Configuração e infraestrutura: `[nomes de variáveis, portas, serviços, sem valores secretos]`
- Dependências e arquivos gerados: `[pacotes, versões, lockfiles, build artifacts]`
- Erros/limitações conhecidos: `[o que ainda não funciona ou não foi testado]`
- Mudanças não planejadas descobertas durante a execução: `[registrar e submeter à nova aprovação quando alterarem o escopo]`

**Diff completo para conferência:** `[link do Pull Request ou caminho do patch]`
**Commit(s), se autorizados:** `[SHAs ou Não se aplica]`

## 3. Verificação

| Verificação | Ambiente/dados usados | Resultado | Evidência |
| --- | --- | --- | --- |
| Testes automatizados afetados | `[ambiente]` | `Pendente` | `[comando e resumo]` |
| Fluxo manual principal | `[ambiente]` | `Pendente` | `[passos e resultado]` |
| Fluxos de erro e permissões | `[ambiente]` | `Pendente` | `[passos e resultado]` |
| Responsividade/acessibilidade, se aplicável | `[navegador/dispositivo]` | `Pendente` | `[capturas ou relato]` |
| Banco, integração e pagamento, se aplicável | `[sandbox/ambiente]` | `Pendente` | `[consulta, teste ou limitação]` |

- Testes **não executados** e motivo: `[listar explicitamente]`
- Impacto em dados existentes: `[descrever]`
- Risco remanescente e mitigação: `[descrever]`
- Plano de reversão: `[passos específicos; considerar banco e compatibilidade]`
- Revisão final do diff: `[responsável, data, link]`

## 4. Aprovação final do grupo

Preencher uma linha para **cada** integrante exigido. A implementação não está liberada para merge/publicação até todas as linhas estarem aprovadas. Não preencher em nome de outra pessoa sem evidência explícita.

| Integrante | Decisão (`Aprovado`/`Revisar`/`Rejeitado`) | Data e evidência da decisão | Observações |
| --- | --- | --- | --- |
| `[nome 1]` | `Pendente` | `[link ou registro]` | `[observação]` |
| `[nome 2]` | `Pendente` | `[link ou registro]` | `[observação]` |

**Resultado do grupo:** `Pendente`
**Autorização para merge:** `Não`
**Autorização para deploy:** `Não`

## 5. Publicação, somente se autorizada

- Responsável, data/hora e ambiente: `[preencher]`
- Commit/tag publicado: `[SHA/tag]`
- Migração ou configuração aplicada: `[descrever; sem segredos]`
- Checagem de saúde e comportamento após publicação: `[evidência]`
- Reversão executada, se houver: `[evidência]`
- Link da versão final deste registro em Markdown/PDF: `[links]`
