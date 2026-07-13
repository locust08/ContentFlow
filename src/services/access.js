export function normalizeRole(role) {
  return ["admin", "staff-editor", "manager-client"].includes(role) ? role : "staff-editor";
}

export function canAccessProject(project, user = null) {
  if (!user) return true;
  const role = normalizeRole(user.role);
  if (role === "admin") return true;
  if (role === "staff-editor") return project.assignedStaffId === user.id;
  return project.clientId === user.clientId || project.reviewerId === user.id;
}

export function filterProjectsForUser(projects = [], user = null) {
  return projects.filter((project) => canAccessProject(project, user));
}

export function canAccessMedia(item, user = null) {
  if (!user) return true;
  const role = normalizeRole(user.role);
  if (role === "admin") return true;
  if (role === "staff-editor") return item.assignedStaffId === user.id;
  return item.clientId === user.clientId || item.reviewerId === user.id;
}

export function filterMediaForUser(items = [], user = null) {
  return items.filter((item) => canAccessMedia(item, user));
}
