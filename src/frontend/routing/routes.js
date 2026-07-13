const LANDING_PATHS = {
  admin: "/dashboard",
  "staff-editor": "/studio",
  "manager-client": "/media"
};

const CLIENT_PATHS = ["/media", "/approvals", "/analytics"];

export function getLandingPath(role) {
  return LANDING_PATHS[role] || "/studio";
}

export function canAccessPath(role, pathname) {
  if (role === "admin") return true;
  if (role === "manager-client") {
    return CLIENT_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  }
  if (role === "staff-editor") {
    return pathname === "/studio"
      || pathname === "/projects"
      || pathname.startsWith("/projects/")
      || pathname === "/media"
      || pathname === "/approvals"
      || pathname === "/analytics";
  }
  return false;
}

export function getProjectPath(project) {
  const workspace = project.type === "auto-clipper" ? "auto-clipper" : "ai-generator";
  return `/projects/${encodeURIComponent(project.name)}/${workspace}`;
}
