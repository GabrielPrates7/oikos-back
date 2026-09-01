-- Up Migration

INSERT INTO categories (user_id, name, type, icon) VALUES
  (NULL, 'Moradia', 'expense', '🏠'),
  (NULL, 'Alimentação', 'expense', '🍽️'),
  (NULL, 'Transporte', 'expense', '🚗'),
  (NULL, 'Contas', 'expense', '🧾'),
  (NULL, 'Lazer', 'expense', '🎮'),
  (NULL, 'Tecnologia', 'expense', '💻'),
  (NULL, 'Roupas', 'expense', '👕'),
  (NULL, 'Educação', 'expense', '📚'),
  (NULL, 'Saúde', 'expense', '💊'),
  (NULL, 'Investimentos', 'expense', '📈'),
  (NULL, 'Outros', 'expense', '📦'),
  (NULL, 'Salário', 'income', '💼'),
  (NULL, 'Freelance', 'income', '🧑‍💻'),
  (NULL, 'Venda', 'income', '🏷️'),
  (NULL, 'Investimentos', 'income', '📈'),
  (NULL, 'Presente', 'income', '🎁'),
  (NULL, 'Outros', 'income', '📦');

-- Down Migration

DELETE FROM categories
WHERE user_id IS NULL
  AND (name, type) IN (
    ('Moradia', 'expense'),
    ('Alimentação', 'expense'),
    ('Transporte', 'expense'),
    ('Contas', 'expense'),
    ('Lazer', 'expense'),
    ('Tecnologia', 'expense'),
    ('Roupas', 'expense'),
    ('Educação', 'expense'),
    ('Saúde', 'expense'),
    ('Investimentos', 'expense'),
    ('Outros', 'expense'),
    ('Salário', 'income'),
    ('Freelance', 'income'),
    ('Venda', 'income'),
    ('Investimentos', 'income'),
    ('Presente', 'income'),
    ('Outros', 'income')
  );
