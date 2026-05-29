-- Migration preparatória para RBAC (as tabelas roles/permissions são criadas na próxima migration)
-- Nenhuma ação necessária aqui — a remoção da coluna legacy 'role' e 'UserRole' enum
-- é feita em 20260403230738_rbac_remove_legacy_role (após as tabelas RBAC existirem)
SELECT 1;
