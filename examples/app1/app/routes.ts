import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  route(
    ":userId/:resourceType/:resourceId/:action",
    "routes/action.$userId.$resourceType.$resourceId.$action.tsx",
  ),
] satisfies RouteConfig;
