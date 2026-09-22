-- Up Migration
-- Dá dono (user_id) a toda categoria hoje compartilhada (user_id NULL). Lista fixa embutida
-- aqui (não lida das linhas NULL atuais) para não depender do estado do banco no momento em
-- que esta migration rodar.

-- 0) Tabela de acompanhamento, só durante esta migration: registra quais categorias por-usuário
--    foram CRIADAS por este UP (distinto do caso em que o usuário já tinha uma própria com o
--    mesmo nome+tipo — essas não entram aqui, e o DOWN não deve mexer nelas).
CREATE TABLE _categories_ownership_migration (
  category_id UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL
);

-- 0b) Idem, mas para o caso de COLISÃO: usuário já tinha uma categoria própria com o mesmo
--     nome+tipo de um padrão, e o ícone dela estava vazio (herdou o de fábrica no passo 1b
--     abaixo). Registrado à parte da tabela acima porque aqui a linha em si não é apagada no
--     DOWN — só o ícone volta a NULL.
CREATE TABLE _categories_icon_backfill_migration (
  category_id UUID PRIMARY KEY REFERENCES categories(id) ON DELETE CASCADE
);

-- 1) Cria, para cada usuário, a cópia que falta de cada categoria padrão (só quando ele ainda
--    não tem uma própria com o mesmo nome+tipo — nesse caso a dele é que vai ser usada).
WITH defaults(name, type, icon) AS (
  VALUES
    ('Moradia', 'expense', '🏠'),
    ('Alimentação', 'expense', '🍽️'),
    ('Transporte', 'expense', '🚗'),
    ('Contas', 'expense', '🧾'),
    ('Lazer', 'expense', '🎮'),
    ('Tecnologia', 'expense', '💻'),
    ('Roupas', 'expense', '👕'),
    ('Educação', 'expense', '📚'),
    ('Saúde', 'expense', '💊'),
    ('Investimentos', 'expense', '📈'),
    ('Outros', 'expense', '📦'),
    ('Salário', 'income', '💼'),
    ('Freelance', 'income', '🧑‍💻'),
    ('Venda', 'income', '🏷️'),
    ('Investimentos', 'income', '📈'),
    ('Presente', 'income', '🎁'),
    ('Outros', 'income', '📦')
),
inserted AS (
  INSERT INTO categories (user_id, name, type, icon)
  SELECT u.id, d.name, d.type, d.icon
  FROM users u
  CROSS JOIN defaults d
  WHERE NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.user_id = u.id AND c.name = d.name AND c.type = d.type
  )
  RETURNING id, name, type
)
INSERT INTO _categories_ownership_migration (category_id, name, type)
SELECT id, name, type FROM inserted;

-- 1b) Colisão: para quem já tinha a categoria própria (não entrou no passo 1 acima), herda o
--     ícone de fábrica SÓ SE o ícone dela estiver vazio hoje — nunca sobrescreve um ícone que o
--     usuário já tenha definido. Categorias recém-criadas no passo 1 já nascem com o ícone
--     certo (icon IS NULL nunca bate nelas, então esta UPDATE não as toca).
WITH defaults(name, type, icon) AS (
  VALUES
    ('Moradia', 'expense', '🏠'),
    ('Alimentação', 'expense', '🍽️'),
    ('Transporte', 'expense', '🚗'),
    ('Contas', 'expense', '🧾'),
    ('Lazer', 'expense', '🎮'),
    ('Tecnologia', 'expense', '💻'),
    ('Roupas', 'expense', '👕'),
    ('Educação', 'expense', '📚'),
    ('Saúde', 'expense', '💊'),
    ('Investimentos', 'expense', '📈'),
    ('Outros', 'expense', '📦'),
    ('Salário', 'income', '💼'),
    ('Freelance', 'income', '🧑‍💻'),
    ('Venda', 'income', '🏷️'),
    ('Investimentos', 'income', '📈'),
    ('Presente', 'income', '🎁'),
    ('Outros', 'income', '📦')
),
backfilled AS (
  UPDATE categories c
  SET icon = d.icon
  FROM defaults d
  WHERE c.user_id IS NOT NULL AND c.name = d.name AND c.type = d.type AND c.icon IS NULL
  RETURNING c.id
)
INSERT INTO _categories_icon_backfill_migration (category_id)
SELECT id FROM backfilled;

-- 2) Redireciona category_id nas 5 tabelas, da linha NULL antiga para a cópia do usuário DONO
--    DA LINHA (resolvido agora por nome+tipo — pega tanto a cópia recém-criada quanto uma já
--    existente do usuário, sem tratamento especial pro caso de colisão).
UPDATE income_entries t
SET category_id = uc.id
FROM categories old, categories uc
WHERE t.category_id = old.id AND old.user_id IS NULL
  AND uc.user_id = t.user_id AND uc.name = old.name AND uc.type = old.type;

UPDATE expenses t
SET category_id = uc.id
FROM categories old, categories uc
WHERE t.category_id = old.id AND old.user_id IS NULL
  AND uc.user_id = t.user_id AND uc.name = old.name AND uc.type = old.type;

UPDATE purchases t
SET category_id = uc.id
FROM categories old, categories uc
WHERE t.category_id = old.id AND old.user_id IS NULL
  AND uc.user_id = t.user_id AND uc.name = old.name AND uc.type = old.type;

UPDATE budgets t
SET category_id = uc.id
FROM categories old, categories uc
WHERE t.category_id = old.id AND old.user_id IS NULL
  AND uc.user_id = t.user_id AND uc.name = old.name AND uc.type = old.type;

UPDATE plan_items t
SET category_id = uc.id
FROM categories old, categories uc
WHERE t.category_id = old.id AND old.user_id IS NULL
  AND uc.user_id = t.user_id AND uc.name = old.name AND uc.type = old.type;

-- 3) Remove as linhas antigas (NULL). Se qualquer linha em qualquer tabela ainda apontar pra
--    uma delas (bug, caso não previsto pelo passo 2), o RESTRICT da FK derruba ESTE DELETE e a
--    transação inteira da migration desfaz — nada fica pela metade.
DELETE FROM categories WHERE user_id IS NULL;

-- Down Migration

-- 1) Recria as 17 categorias padrão como linhas NULL novas (ids novos — mesmo espírito do down
--    da migration original de seed: recriação por conteúdo, não restauração de id).
WITH defaults(name, type, icon) AS (
  VALUES
    ('Moradia', 'expense', '🏠'),
    ('Alimentação', 'expense', '🍽️'),
    ('Transporte', 'expense', '🚗'),
    ('Contas', 'expense', '🧾'),
    ('Lazer', 'expense', '🎮'),
    ('Tecnologia', 'expense', '💻'),
    ('Roupas', 'expense', '👕'),
    ('Educação', 'expense', '📚'),
    ('Saúde', 'expense', '💊'),
    ('Investimentos', 'expense', '📈'),
    ('Outros', 'expense', '📦'),
    ('Salário', 'income', '💼'),
    ('Freelance', 'income', '🧑‍💻'),
    ('Venda', 'income', '🏷️'),
    ('Investimentos', 'income', '📈'),
    ('Presente', 'income', '🎁'),
    ('Outros', 'income', '📦')
)
INSERT INTO categories (user_id, name, type, icon)
SELECT NULL, name, type, icon FROM defaults;

-- 2) Reverte o redirecionamento: qualquer linha das 5 tabelas cujo category_id hoje bate por
--    nome+tipo com um dos 17 padrões volta pra categoria NULL recém-recriada com o mesmo
--    nome+tipo — para TODO usuário, tenha a cópia sido criada por esta migration ou já
--    existisse antes dela (o redirecionamento do UP tratou as duas do mesmo jeito).
UPDATE income_entries t
SET category_id = nullcat.id
FROM categories cur, categories nullcat
WHERE t.category_id = cur.id AND cur.user_id IS NOT NULL
  AND nullcat.user_id IS NULL AND nullcat.name = cur.name AND nullcat.type = cur.type
  ;

UPDATE expenses t
SET category_id = nullcat.id
FROM categories cur, categories nullcat
WHERE t.category_id = cur.id AND cur.user_id IS NOT NULL
  AND nullcat.user_id IS NULL AND nullcat.name = cur.name AND nullcat.type = cur.type
  ;

UPDATE purchases t
SET category_id = nullcat.id
FROM categories cur, categories nullcat
WHERE t.category_id = cur.id AND cur.user_id IS NOT NULL
  AND nullcat.user_id IS NULL AND nullcat.name = cur.name AND nullcat.type = cur.type
  ;

UPDATE budgets t
SET category_id = nullcat.id
FROM categories cur, categories nullcat
WHERE t.category_id = cur.id AND cur.user_id IS NOT NULL
  AND nullcat.user_id IS NULL AND nullcat.name = cur.name AND nullcat.type = cur.type
  ;

UPDATE plan_items t
SET category_id = nullcat.id
FROM categories cur, categories nullcat
WHERE t.category_id = cur.id AND cur.user_id IS NOT NULL
  AND nullcat.user_id IS NULL AND nullcat.name = cur.name AND nullcat.type = cur.type
  ;

-- 3) Desfaz o backfill de ícone (volta a NULL só nas categorias que ESTA migration alterou —
--    a colisão volta a ficar exatamente como estava antes do UP) e apaga a tabela de rastreio.
UPDATE categories SET icon = NULL
WHERE id IN (SELECT category_id FROM _categories_icon_backfill_migration);

DROP TABLE _categories_icon_backfill_migration;

-- 4) Apaga só as categorias que ESTA migration criou (tabela de acompanhamento) — a cópia do
--    usuário que já existia antes (caso de colisão) sobrevive intacta, como antes do UP.
DELETE FROM categories WHERE id IN (SELECT category_id FROM _categories_ownership_migration);

DROP TABLE _categories_ownership_migration;
