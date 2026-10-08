// InsureBot authorization policies (step 10). Language: Cedar, https://www.cedarpolicy.com
//
// How Cedar decides:
//   - default is DENY: a request is allowed only if some "permit" matches
//   - and no "forbid" matches: a forbid always wins over a permit
//
// Entities the PDP builds from each AuthZEN request:
//   principal  User::"<sub>"      { tenant: String, roles: Set<String> }   (from the verified token)
//   action     Action::"<tool>"
//   resource   Agency | Quote | Customer, always with { tenant: String }
//
// The PDP reloads this folder every 2 seconds: changing a rule needs no rebuild and no redeploy.

// Users may act on resources of their own agency, and nothing else.
@id("same-agency")
permit (principal, action, resource)
when { principal.tenant == resource.tenant };

// Admin tools are for admins. (InsureBot also hides them from other users' tool lists;
// this rule is what still holds if that code ever changes.)
@id("admin-tools-need-admin")
forbid (
  principal,
  action in [Action::"agency_stats", Action::"export_report", Action::"get_report"],
  resource
)
unless { principal.roles.contains("admin") };

// Business rule: charging more than €200 per month needs an admin. Amounts are in cents.
// Changing 20000 here changes the rule everywhere, with no code change.
@id("big-premium-needs-admin")
forbid (principal, action == Action::"charge_premium", resource is Quote)
when { resource.amountCents > 20000 }
unless { principal.roles.contains("admin") };

// Episode 13 as a policy: a quote may only be emailed to the customer's own address on file.
// The code already does this; the rule catches a future bug that would send it anywhere else.
@id("email-only-to-customer")
forbid (principal, action == Action::"email_quote", resource is Customer)
unless { context has recipient && context.recipient == resource.email };
