# polizy

## 0.2.0

### Minor Changes

- 88f3456: Add comprehensive Agent Skills for polizy authorization library

  Create 6 specialized Agent Skills (24 markdown files, 8,765 lines) to help AI agents effectively use the polizy library:

  - **polizy**: Router skill for context-aware detection and routing
  - **polizy-setup**: Installation and initial configuration guides
  - **polizy-schema**: Schema design patterns with 10+ domain-specific examples
  - **polizy-patterns**: 7 implementation patterns (direct, groups, hierarchy, field-level, time-limited, revocation, multi-tenant)
  - **polizy-storage**: Database adapters (Prisma, custom) and performance optimization
  - **polizy-troubleshooting**: Debugging guide with check algorithm explanation and anti-patterns

  All skills follow the Agent Skills specification with progressive disclosure (SKILL.md under 500 lines, detailed content in references/).

## 0.1.1

### Patch Changes

- Fix CI build errors and improve Prisma adapter compatibility

  - Remove dependency on @prisma/client for type checking by using minimal PrismaClientLike interface
  - Fix rollup TypeScript config to handle allowImportingTsExtensions properly
  - Add npm OIDC trusted publishing with provenance
