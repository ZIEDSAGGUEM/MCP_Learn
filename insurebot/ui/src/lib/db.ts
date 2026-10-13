// Read-only access to the audit log, as insurebot_lab_viewer (member of insurebot_auditor: SELECT on audit_log only).
import pg from "pg";
import { cfg } from "./config";

const g = globalThis as unknown as { __labPool?: pg.Pool };
export const auditPool = () => (g.__labPool ??= new pg.Pool({ connectionString: cfg().auditDatabaseUrl, max: 3 }));
