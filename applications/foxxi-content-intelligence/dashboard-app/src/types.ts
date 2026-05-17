/**
 * Shared types for the Foxxi dashboard.
 *
 * These mirror the substrate-side shapes from
 * applications/foxxi-content-intelligence/src/enrollment.ts +
 * src/course-qa.ts so the client-side stays in sync with the bridge
 * contract.
 */

export interface AdminMeta {
  tenant: string;
  tenant_pod: string;
  admin_user_web_id: string;
  admin_user_name: string;
  admin_user_role: string;
  tenant_id: string;
}

export interface CatalogEntry {
  course_id: string;
  title: string;
  category: string;
  audience_tags: string[];
  owner: string;
  authoring_tool: string;
  standard: string;
  concept_count: number;
  slide_count: number;
  audio_seconds: number;
  is_real?: boolean;
  parse_status?: string;
  shacl_violations?: number;
  last_modified?: string;
  last_parsed?: string;
  lms_source?: string;
}

export interface AdminUser {
  user_id: string;
  web_id: string;
  name: string;
  email: string;
  department: string;
  job_title: string;
  manager_user_id?: string | null;
  location?: string;
  audience_tags: string[];
  status: string;
  employee_id?: string;
  hire_date: string;
}

export interface AdminGroup {
  group_id: string;
  name: string;
  kind: string;
  member_count: number;
  member_ids: string[];
  description?: string;
}

export interface AdminPolicy {
  policy_id: string;
  course_id: string;
  course_title: string;
  audience_group_id: string;
  audience_label: string;
  audience_member_count?: number;
  requirement_type: 'required' | 'recommended';
  trigger: string;
  due_relative_days: number;
  created_at: string;
  created_by_user_id?: string;
  created_by_name?: string;
  enabled: boolean;
}

export interface AdminEvent {
  event_id: string;
  user_id: string;
  course_id: string;
  policy_id: string;
  assigned_at: string;
  due_at: string;
  status: string;
  completed_at?: string | null;
  requirement_type: string;
}

export interface AdminCoverageEntry {
  concept_label: string;
  taught_in_courses: string[];
  taught_count: number;
  mentioned_in_courses: string[];
  mentioned_count: number;
  only_mentioned_count: number;
  categories: string[];
}

export interface AdminConnection {
  id: string;
  kind: string;
  product: string;
  instance: string;
  status: string;
  auth_method: string;
  last_sync: string;
  sync_frequency: string;
  courses_contributed: number;
  auth_warning?: string | null;
}

export interface AdminAuditEntry {
  audit_id: string;
  timestamp: string;
  actor_user_id: string;
  actor_web_id?: string;
  action: string;
  target_type: string;
  target_id: string;
  result: string;
  reason?: string;
}

export interface AdminPayload {
  meta: AdminMeta;
  catalog: CatalogEntry[];
  users: AdminUser[];
  groups: AdminGroup[];
  policies: AdminPolicy[];
  events: AdminEvent[];
  audit: AdminAuditEntry[];
  coverage: AdminCoverageEntry[];
  connections: AdminConnection[];
}

export interface EnrolledCourse {
  courseId: string;
  courseTitle: string;
  category: string;
  requirementType: 'required' | 'recommended';
  policyId: string;
  assignedAt: string;
  dueAt: string;
  status: 'pending' | 'completed' | 'overdue';
  completedAt?: string;
}

export interface CourseConcept {
  id: string;
  label: string;
  confidence: number;
  tier: number;
  taught_in_slides?: string[];
}

export interface CourseTranscript {
  duration: number;
  language: string;
  text: string;
}

export interface CourseContent {
  courseIri: string;
  title: string;
  authoritativeSource: string;
  transcripts: Record<string, CourseTranscript>;
  concepts: CourseConcept[];
}
