# Aave Action Provider

This directory contains the Aave V3 Action Provider implementation for AgentKit.

## Structure

```
aave/
├── aaveActionProvider.ts       # Supply / withdraw against Aave V3 pools
├── aaveActionProvider.test.ts  # Unit tests
├── constants.ts                # Address-book pool loader + resolve helpers
├── schemas.ts                  # Zod schemas for supply / withdraw
├── index.ts                    # Exports
└── README.md                   # This file
```

## Actions

| Action | Description |
| --- | --- |
| `aave_supply` | Approve + supply underlying into an Aave V3 Pool |
| `aave_withdraw` | Withdraw underlying (supports `amount=max`) |

Pool addresses come from `@bgd-labs/aave-address-book` (all mainnet `AaveV3*` instances). Multi-instance chains (e.g. Ethereum Core / Lido / EtherFi) require an explicit `poolAddress`.

## Notes

- Referral code defaults to `0`.
- Thirdfy API earn flows (`deposit_earn_position` / `withdraw_earn_position` with `providerId=aave`) remain the product registry path; this provider is for AgentKit consumers that call Aave directly.
- Borrow / repay / collateral toggles live in Thirdfy API AgentKit wrappers, not this package action set.

## Adding functionality

1. Add or update schemas in `schemas.ts`
2. Implement the action in `aaveActionProvider.ts`
3. Add tests in `aaveActionProvider.test.ts`
