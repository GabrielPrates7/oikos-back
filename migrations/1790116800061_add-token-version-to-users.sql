-- Up Migration
-- Permite invalidar todas as sessões de um usuário sem esperar o access token expirar
-- sozinho: cada JWT (access e refresh) embute o token_version vigente no momento da emissão;
-- o middleware de autenticação compara com o valor atual na tabela a cada requisição.
-- Incrementar este valor (troca de senha, e no futuro exclusão de conta) invalida
-- imediatamente qualquer token emitido antes.
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;

-- Down Migration
ALTER TABLE users DROP COLUMN token_version;
