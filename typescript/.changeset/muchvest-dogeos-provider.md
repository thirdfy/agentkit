---
"@thirdfy/agentkit": patch
---

Added the Much Vest DogeOS testnet provider with registry reads, unsigned transaction preparation, exact ERC20 approval, atomic grant creation, and fixed-beneficiary claims through the caller's wallet provider. Writes require a host-injected durable execution policy with stable request IDs, exact nonce/fee envelopes, DogeOS data-fee reservations and canonical receipt accounting; ambiguous submissions never resend automatically.
