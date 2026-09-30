# Implantação do vínculo estável de garçons

Aplique primeiro a migração 20260929220000_link_garcom_identity, registrada em drizzle/meta/_journal.json. Depois publique o schema e as rotas corrigidas. A migração é aditiva: cria usuarios.better_auth_user_id, uma restrição de unicidade e uma chave estrangeira para user.id. Contas apenas da autenticação própria podem manter o campo nulo.

Os novos garçons criados por POST /api/garcons recebem automaticamente o vínculo com o ID da conta Better Auth, na mesma transação que user, profiles, account e usuarios. A edição usa esse ID e o restaurante da sessão; o e-mail deixa de identificar a conta correspondente. A senha só é alterada na conta credential vinculada.

## Contas antigas

A migração não associa contas pelo e-mail e não altera os restaurantes ou perfis existentes. Uma conta antiga sem vínculo validado retorna 409 ao tentar editar ou excluir por /api/garcons/:id. É necessário revisar as duas identidades e registrar explicitamente qual usuarios.id corresponde a qual user.id.

A revisão deve confirmar: identidade real da pessoa, restaurante igual ao perfil da conta Better Auth, papel garcom em user, profiles e usuarios, ausência de outro vínculo já registrado e conta credential existente quando houver autenticação por senha. O e-mail pode ajudar na conferência humana, mas não deve ser a única prova nem um mecanismo automático de associação.

Após a conferência, um administrador do banco deve gravar o ID Better Auth no registro exato de usuarios, condicionando a alteração ao ID do usuário próprio, restaurante verificado e vínculo ainda nulo. Essa tarefa não foi executada no banco da Newly. Casos sem correspondência comprovada devem continuar pendentes; não atribua o primeiro restaurante nem substitua vínculos existentes.

Não há novo campo editável no frontend: o servidor preenche e usa o vínculo. O frontend deve mostrar a mensagem de revisão quando receber 409, em vez de informar sucesso.

## Verificação

Execute o typecheck, o build, o teste de handlers (Node.js 24+) e a suíte HTTP em banco descartável, conforme o PR. Teste A tentando editar B: 404 sem alterações. Teste uma conta própria sem vínculo: 409 sem alterações. Teste uma conta vinculada: nome/e-mail/senha sincronizados, novo login funcionando e edição posterior à troca de e-mail mantendo a mesma identidade.

As verificações locais usam autenticação e banco simulados. Elas comprovam os ramos dos handlers, inclusive rollback simulado, mas não substituem execução da migração, transações PostgreSQL, autenticação real ou testes HTTP.
