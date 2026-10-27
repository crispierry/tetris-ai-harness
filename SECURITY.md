# Security

This project is a local research application. The server listens on loopback and serves only `public/`. It is not a hardened multi-user hosting service. Do not expose the paid backend through a public tunnel or deploy private owner configurations with static assets.

API keys remain in a private owner file outside the repository. Paid requests require explicit activation, authenticated local pairing, canonical packet validation and a durable single-owner ledger. Browser code never receives the API key. Do not delete a ledger, steal its lock or re-enroll a lineage to bypass an interrupted request or spending allowance.

If you find a vulnerability, use GitHub's private vulnerability reporting when available. Otherwise open an issue requesting a private reporting channel without posting exploit details, keys or personal data. Never submit a real credential as a reproduction. If a key has been disclosed, revoke it with its provider; deleting a file or rewriting Git history does not revoke the key.

The current default branch is the supported source version. Old replay formats are accepted only by their explicit compatibility verifiers. An exported record proves internal recorded consistency, not provider identity, billing accuracy or real elapsed time.

Project thresholds may be enforced with delay. Usage-based cost estimates are not invoices or a guarantee of remaining budget. Unknown outcomes remain debited and require explicit owner reconciliation; the service makes no automatic paid retry.
