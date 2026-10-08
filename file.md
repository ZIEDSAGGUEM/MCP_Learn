Week 1: Shared reading

MCP 2026-07-28 launch post · blog.modelcontextprotocol.io/posts/2026-07-28/
Changelog · modelcontextprotocol.io/specification/2026-07-28/changelog
Security Best Practices · modelcontextprotocol.io/docs/tutorials/security/security_best_practices
OWASP LLM Top 10 2026 · genai.owasp.org/llm-top-10/
OWASP MCP Top 10 · owasp.org/www-project-mcp-top-10/

Month 1: MCP from the data side

Base protocol and meta · modelcontextprotocol.io/specification/2026-07-28/basic/index
MCP is now stateless: no sessions, no handshake
Server-minted handles replace sessions: sign them, bind to a principal, expire them
Caching · modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
Wrong cacheScope can leak one tenant's tool list to another
Pair with Mohamed one session a week
Month 2: Tenant isolation in the database

RLS with an MCP server (pgEdge) · github.com/pgEdge/pgedge-postgres-mcp/blob/main/docs/advanced/row-level-security.md
RLS walkthrough · oneuptime.com/blog/post/2026-01-25-row-level-security-postgresql/view
Postgres for AI agents (Supabase) · supabase.com/blog/postgres-best-practices-for-ai-agents
Owners bypass RLS unless FORCE ROW LEVEL SECURITY is set
Set tenant per transaction with SET LOCAL
Tenant comes from the verified token, never from the client or model
OWASP MCP02, Privilege Escalation via Scope Creep
Month 3: Policy as code

Cedar + tinytodo tutorial · docs.cedarpolicy.com/overview/resources.html
OPA and Rego · openpolicyagent.org/docs/policy-language
Microsoft Agent Governance Toolkit, tutorial 08 · microsoft.github.io/agent-governance-toolkit/tutorials/08-opa-rego-cedar-policies/
Dogwood, rules over sequences of agent actions · docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy-temporal.html
Learn Dogwood's model, don't deploy its interpreter (AWS says not production-ready)
AuthZEN Authorization API 1.0 · openid.net/specs/authorization-api-1_0.html
