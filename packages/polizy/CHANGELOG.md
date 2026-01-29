# polizy

## 0.1.1

### Patch Changes

- Fix CI build errors and improve Prisma adapter compatibility

  - Remove dependency on @prisma/client for type checking by using minimal PrismaClientLike interface
  - Fix rollup TypeScript config to handle allowImportingTsExtensions properly
  - Add npm OIDC trusted publishing with provenance
