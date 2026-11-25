# Stellar SDK Bundle Optimization (#484)

To prevent pulling the complete `@stellar/stellar-sdk` library into client chunks:

- Import tree-shakeable sub-modules directly where possible.
- Retain SDK imports in server components and API routes.
