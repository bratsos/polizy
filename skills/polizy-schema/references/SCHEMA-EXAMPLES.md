# Schema Examples by Domain

Real-world schema examples for common application types.

---

## 1. Document Collaboration (Google Docs-style)

```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    commenter: { type: "direct" },
    viewer: { type: "direct" },
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    // Document lifecycle
    delete: ["owner"],
    transfer_ownership: ["owner"],

    // Content modification
    edit: ["owner", "editor"],
    comment: ["owner", "editor", "commenter"],

    // Reading
    view: ["owner", "editor", "commenter", "viewer"],

    // Sharing
    share: ["owner", "editor"],
  },
  hierarchyPropagation: {
    view: ["view"],
    edit: ["edit"],
    comment: ["comment"],
  },
});

// Usage:
// - Create document: assign owner
// - Share with view/edit/comment access
// - Put in folders for inherited access
// - Share with teams via groups
```

---

## 2. Project Management (Jira/Asana-style)

```typescript
const schema = defineSchema({
  relations: {
    // Project roles
    project_admin: { type: "direct" },
    project_member: { type: "direct" },
    project_viewer: { type: "direct" },

    // Task roles
    assignee: { type: "direct" },
    reporter: { type: "direct" },
    watcher: { type: "direct" },

    // Organizational
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Task → Project
  },
  actionToRelations: {
    // Project actions
    manage_project: ["project_admin"],
    create_task: ["project_admin", "project_member"],
    view_project: ["project_admin", "project_member", "project_viewer"],

    // Task actions
    edit_task: ["project_admin", "assignee", "reporter"],
    transition_task: ["project_admin", "assignee"],
    comment_task: ["project_admin", "project_member", "assignee", "reporter", "watcher"],
    view_task: ["project_admin", "project_member", "project_viewer", "assignee", "reporter", "watcher"],

    // Assignment
    assign_task: ["project_admin", "reporter"],
  },
  hierarchyPropagation: {
    view_task: ["view_project"],
    comment_task: ["view_project"],
  },
});

// Usage:
// - Users are project_admin/member/viewer on projects
// - Tasks have parent → project
// - Assignee/reporter have specific task permissions
// - Teams can be granted project access via groups
```

---

## 3. Multi-Tenant SaaS

```typescript
const schema = defineSchema({
  relations: {
    // Tenant roles
    org_owner: { type: "direct" },
    org_admin: { type: "direct" },
    org_member: { type: "direct" },

    // Resource roles
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Resource → Org
  },
  actionToRelations: {
    // Organization management
    manage_billing: ["org_owner"],
    manage_members: ["org_owner", "org_admin"],
    view_org: ["org_owner", "org_admin", "org_member"],

    // Resource actions
    delete: ["owner", "org_admin"],
    edit: ["owner", "editor", "org_admin"],
    view: ["owner", "editor", "viewer", "org_admin", "org_member"],
  },
  hierarchyPropagation: {
    view: ["view_org"],  // org_member can view all resources
  },
});

// Usage:
// - Each organization is a separate object
// - Resources have parent → organization
// - org_member can view all resources in their org
// - org_admin can manage all resources
// - Individual resource permissions for external sharing
```

---

## 4. Content Management System (CMS)

```typescript
const schema = defineSchema({
  relations: {
    // Content roles
    author: { type: "direct" },
    editor: { type: "direct" },
    reviewer: { type: "direct" },
    publisher: { type: "direct" },

    // Site roles
    site_admin: { type: "direct" },
    contributor: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Post → Category → Site
  },
  actionToRelations: {
    // Content lifecycle
    create_draft: ["author", "contributor", "site_admin"],
    edit_draft: ["author", "editor", "site_admin"],
    submit_for_review: ["author", "site_admin"],
    review: ["reviewer", "editor", "site_admin"],
    approve: ["reviewer", "site_admin"],
    publish: ["publisher", "site_admin"],
    unpublish: ["publisher", "site_admin"],

    // Reading
    view_draft: ["author", "editor", "reviewer", "site_admin"],
    view_published: ["author", "editor", "reviewer", "publisher", "contributor", "site_admin"],

    // Site management
    manage_site: ["site_admin"],
    manage_categories: ["site_admin", "editor"],
  },
  hierarchyPropagation: {
    view_published: ["view_published"],
    view_draft: ["view_draft"],
  },
});

// Usage:
// - Authors create drafts
// - Editors review and improve
// - Reviewers approve for publishing
// - Publishers push live
// - Site admins have full control
```

---

## 5. E-Commerce Platform

```typescript
const schema = defineSchema({
  relations: {
    // Store roles
    store_owner: { type: "direct" },
    store_manager: { type: "direct" },
    store_staff: { type: "direct" },

    // Product roles
    product_manager: { type: "direct" },

    // Customer relations
    customer: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Product → Category → Store
  },
  actionToRelations: {
    // Store management
    manage_store: ["store_owner"],
    manage_staff: ["store_owner", "store_manager"],
    view_analytics: ["store_owner", "store_manager"],

    // Product management
    create_product: ["store_owner", "store_manager", "product_manager"],
    edit_product: ["store_owner", "store_manager", "product_manager"],
    delete_product: ["store_owner", "store_manager"],
    view_product: ["store_owner", "store_manager", "store_staff", "product_manager"],

    // Order management
    view_orders: ["store_owner", "store_manager", "store_staff"],
    process_orders: ["store_owner", "store_manager", "store_staff"],
    refund_orders: ["store_owner", "store_manager"],

    // Customer actions
    place_order: ["customer"],
    view_own_orders: ["customer"],
  },
  hierarchyPropagation: {
    view_product: ["view_product"],
    edit_product: ["edit_product"],
  },
});
```

---

## 6. Healthcare Records (HIPAA-aware)

```typescript
const schema = defineSchema({
  relations: {
    // Provider roles
    primary_physician: { type: "direct" },
    specialist: { type: "direct" },
    nurse: { type: "direct" },

    // Administrative roles
    admin: { type: "direct" },
    billing: { type: "direct" },

    // Patient relations
    patient: { type: "direct" },
    guardian: { type: "direct" },

    // Emergency
    emergency_provider: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    // Full medical record
    view_full_record: ["primary_physician", "admin"],
    edit_medical_record: ["primary_physician", "specialist"],

    // Treatment notes
    view_treatment: ["primary_physician", "specialist", "nurse"],
    add_treatment: ["primary_physician", "specialist", "nurse"],

    // Sensitive data
    view_mental_health: ["primary_physician"],
    view_substance_abuse: ["primary_physician"],

    // Patient access
    view_own_record: ["patient", "guardian"],
    request_records: ["patient", "guardian"],

    // Billing
    view_billing: ["admin", "billing", "patient", "guardian"],
    edit_billing: ["admin", "billing"],

    // Emergency override
    emergency_access: ["emergency_provider"],
  },
});

// Note: Field-level permissions are critical here
// Use: { type: "record", id: "patient123#mental_health" }
```

---

## 7. Learning Management System (LMS)

```typescript
const schema = defineSchema({
  relations: {
    // Course roles
    instructor: { type: "direct" },
    teaching_assistant: { type: "direct" },
    student: { type: "direct" },
    auditor: { type: "direct" },

    // Institution roles
    admin: { type: "direct" },
    department_head: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Assignment → Module → Course
  },
  actionToRelations: {
    // Course management
    manage_course: ["instructor", "admin"],
    edit_content: ["instructor", "teaching_assistant"],
    view_content: ["instructor", "teaching_assistant", "student", "auditor"],

    // Assignments
    create_assignment: ["instructor", "teaching_assistant"],
    submit_assignment: ["student"],
    grade_assignment: ["instructor", "teaching_assistant"],
    view_grades: ["instructor", "teaching_assistant"],
    view_own_grades: ["student"],

    // Discussion
    post_discussion: ["instructor", "teaching_assistant", "student"],
    moderate_discussion: ["instructor", "teaching_assistant"],
    view_discussion: ["instructor", "teaching_assistant", "student", "auditor"],

    // Analytics
    view_analytics: ["instructor", "admin", "department_head"],
  },
  hierarchyPropagation: {
    view_content: ["view_content"],
    edit_content: ["edit_content"],
  },
});
```

---

## 8. DevOps/Infrastructure

```typescript
const schema = defineSchema({
  relations: {
    // Environment roles
    env_admin: { type: "direct" },
    deployer: { type: "direct" },
    viewer: { type: "direct" },

    // Service roles
    service_owner: { type: "direct" },
    on_call: { type: "direct" },

    // Security roles
    security_admin: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Service → Environment → Project
  },
  actionToRelations: {
    // Deployment
    deploy: ["env_admin", "deployer", "service_owner"],
    rollback: ["env_admin", "deployer", "service_owner"],
    view_deployments: ["env_admin", "deployer", "service_owner", "viewer", "on_call"],

    // Configuration
    edit_config: ["env_admin", "service_owner", "security_admin"],
    view_config: ["env_admin", "deployer", "service_owner", "on_call"],
    view_secrets: ["env_admin", "security_admin"],

    // Monitoring
    view_logs: ["env_admin", "deployer", "service_owner", "on_call", "viewer"],
    view_metrics: ["env_admin", "deployer", "service_owner", "on_call", "viewer"],

    // Incidents
    acknowledge_alert: ["env_admin", "on_call", "service_owner"],
    resolve_incident: ["env_admin", "on_call", "service_owner"],

    // Access management
    manage_access: ["env_admin", "security_admin"],
  },
  hierarchyPropagation: {
    view_logs: ["view_logs"],
    view_metrics: ["view_metrics"],
    view_deployments: ["view_deployments"],
  },
});
```

---

## 9. Social Platform / Forum

```typescript
const schema = defineSchema({
  relations: {
    // Platform roles
    platform_admin: { type: "direct" },
    moderator: { type: "direct" },

    // Community roles
    community_owner: { type: "direct" },
    community_moderator: { type: "direct" },
    community_member: { type: "direct" },

    // Content ownership
    author: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Comment → Post → Community
  },
  actionToRelations: {
    // Platform management
    manage_platform: ["platform_admin"],
    ban_user: ["platform_admin", "moderator"],

    // Community management
    manage_community: ["community_owner", "platform_admin"],
    moderate_community: ["community_owner", "community_moderator", "moderator"],

    // Content creation
    create_post: ["community_member", "community_moderator", "community_owner"],
    edit_own_post: ["author"],
    delete_own_post: ["author"],
    edit_any_post: ["community_moderator", "community_owner", "moderator", "platform_admin"],
    delete_any_post: ["community_moderator", "community_owner", "moderator", "platform_admin"],

    // Engagement
    comment: ["community_member", "community_moderator", "community_owner"],
    react: ["community_member", "community_moderator", "community_owner"],
    view: ["community_member", "community_moderator", "community_owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
    moderate_community: ["moderate_community"],
  },
});
```

---

## 10. API Gateway / Developer Portal

```typescript
const schema = defineSchema({
  relations: {
    // Organization roles
    org_owner: { type: "direct" },
    org_admin: { type: "direct" },
    developer: { type: "direct" },

    // API roles
    api_owner: { type: "direct" },
    api_consumer: { type: "direct" },

    // Structure
    member: { type: "group" },
    parent: { type: "hierarchy" },  // Endpoint → API → Organization
  },
  actionToRelations: {
    // Organization
    manage_org: ["org_owner"],
    manage_billing: ["org_owner", "org_admin"],
    view_org: ["org_owner", "org_admin", "developer"],

    // API management
    create_api: ["org_owner", "org_admin", "developer"],
    edit_api: ["api_owner", "org_admin"],
    delete_api: ["api_owner", "org_owner"],
    view_api: ["api_owner", "api_consumer", "developer", "org_admin"],

    // API keys
    create_api_key: ["api_owner", "api_consumer"],
    revoke_api_key: ["api_owner", "org_admin"],
    view_api_keys: ["api_owner"],

    // Usage & Analytics
    view_usage: ["api_owner", "api_consumer", "org_admin"],
    view_analytics: ["api_owner", "org_admin"],

    // Rate limits
    configure_rate_limits: ["api_owner", "org_admin"],
  },
  hierarchyPropagation: {
    view_api: ["view_api"],
    view_usage: ["view_usage"],
  },
});
```

---

## 11. File Storage (Dropbox-style)

```typescript
const schema = defineSchema({
  relations: {
    owner: { type: "direct" },
    editor: { type: "direct" },
    viewer: { type: "direct" },
    uploader: { type: "direct" },  // Can add but not edit/delete
    member: { type: "group" },
    parent: { type: "hierarchy" },
  },
  actionToRelations: {
    // File operations
    delete: ["owner"],
    rename: ["owner", "editor"],
    move: ["owner", "editor"],
    edit: ["owner", "editor"],
    download: ["owner", "editor", "viewer"],
    view: ["owner", "editor", "viewer"],

    // Upload (folder-specific)
    upload: ["owner", "editor", "uploader"],

    // Sharing
    share: ["owner"],
    change_permissions: ["owner"],
  },
  hierarchyPropagation: {
    view: ["view"],
    download: ["download"],
    edit: ["edit"],
    upload: ["upload"],
  },
});
```

---

## Schema Design Checklist

When designing your schema:

1. **List all user roles** - Who are the actors?
2. **List all resources** - What are users accessing?
3. **List all actions** - What can users do?
4. **Map roles to actions** - Which roles can do what?
5. **Identify groups** - Are there teams/departments?
6. **Identify hierarchies** - Are resources nested?
7. **Define propagation** - Which actions inherit?
8. **Start minimal** - Add complexity only when needed
