/**
 * Foxxi competency framework → 1EdTech CASE 1.0 JSON-LD exporter.
 *
 * Takes a fxk:SkillFramework + the fxk:Skill / rcd:CompetencyDefinition
 * instances belonging to it, and emits a CASE 1.0 JSON-LD document the
 * standard tools (institutional CASE servers, CaSS, downstream LMSes)
 * can consume.
 *
 * Standards reference:
 *   - 1EdTech CASE 1.0 (Competencies and Academic Standards Exchange)
 *     https://www.imsglobal.org/spec/case/v1p0
 *
 * Mapping:
 *   fxk:SkillFramework        → case:CFDocument
 *   fxk:Skill                 → case:CFItem
 *   fxk:fromFramework         → case:CFDocumentURI on each item
 *   fxk:prerequisiteOf        → case:CFAssociation { associationType: "isPrerequisiteOf" }
 *   rcd:CompetencyDefinition  → case:CFItem with case:abbreviatedStatement = rcd:statement
 *   rcd:hasProficiencyLevel   → case:CFRubric / case:CFRubricCriterion + case:CFRubricCriterionLevel
 *
 * Skills that come from external frameworks (O*NET / ESCO / Lightcast)
 * are emitted as case:exactMatchOf links to the upstream IRI so the
 * downstream CASE tooling can pull the upstream definition directly.
 */

export interface FoxxiSkill {
  id: string;
  label: string;
  framework?: string;
  prerequisiteOf?: readonly string[];
  /** RDCEO additions (optional). */
  statement?: string;
  scope?: string;
  proficiencyLevel?: 'Novice' | 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
  externalIri?: string;
}

export interface FoxxiSkillFramework {
  id: string;
  title: string;
  description?: string;
  publisher?: string;
  /** External CASE framework IRI this aligns to (if any). */
  caseFrameworkRef?: string;
  skills: readonly FoxxiSkill[];
}

export interface CaseDocument {
  '@context': string;
  type: 'CFDocument';
  identifier: string;
  uri: string;
  CFPackageURI: string;
  creator: string;
  title: string;
  description?: string;
  lastChangeDateTime: string;
  CFItems: CaseItem[];
  CFAssociations: CaseAssociation[];
  CFRubrics?: CaseRubric[];
}

export interface CaseItem {
  identifier: string;
  uri: string;
  CFItemType: string;
  humanCodingScheme?: string;
  fullStatement: string;
  abbreviatedStatement?: string;
  CFDocumentURI: string;
  lastChangeDateTime: string;
  exactMatchOf?: string;
}

export interface CaseAssociation {
  identifier: string;
  uri: string;
  associationType: string;
  CFDocumentURI: string;
  originNodeURI: { identifier: string; uri: string };
  destinationNodeURI: { identifier: string; uri: string };
  lastChangeDateTime: string;
}

export interface CaseRubric {
  identifier: string;
  uri: string;
  title: string;
  description?: string;
  CFRubricCriteria: CaseRubricCriterion[];
}

export interface CaseRubricCriterion {
  identifier: string;
  uri: string;
  category: string;
  description: string;
  CFRubricCriterionLevels: CaseRubricCriterionLevel[];
}

export interface CaseRubricCriterionLevel {
  identifier: string;
  uri: string;
  quality: string;
  description: string;
  feedback?: string;
  score: number;
}

/**
 * Convert a Foxxi skill framework to CASE 1.0 JSON-LD. Pure function —
 * no I/O. Caller decides whether to serve it as `application/json` on
 * an HTTP endpoint, write it to disk, or publish it as a pod descriptor.
 */
export function frameworkToCase(framework: FoxxiSkillFramework): CaseDocument {
  const now = new Date().toISOString();
  const docUri = framework.id;

  const items: CaseItem[] = framework.skills.map(skill => {
    const item: CaseItem = {
      identifier: hashId(skill.id),
      uri: skill.id,
      CFItemType: skill.proficiencyLevel ? 'Competency' : 'Skill',
      humanCodingScheme: skill.label,
      fullStatement: skill.statement ?? skill.label,
      abbreviatedStatement: skill.label,
      CFDocumentURI: docUri,
      lastChangeDateTime: now,
    };
    if (skill.externalIri) item.exactMatchOf = skill.externalIri;
    return item;
  });

  const associations: CaseAssociation[] = [];
  for (const skill of framework.skills) {
    for (const next of skill.prerequisiteOf ?? []) {
      if (!framework.skills.some(s => s.id === next)) continue;
      associations.push({
        identifier: hashId(`prereq:${skill.id}:${next}`),
        uri: `${docUri}#assoc-${hashId(skill.id)}-${hashId(next)}`,
        associationType: 'isPrerequisiteOf',
        CFDocumentURI: docUri,
        originNodeURI: { identifier: hashId(skill.id), uri: skill.id },
        destinationNodeURI: { identifier: hashId(next), uri: next },
        lastChangeDateTime: now,
      });
    }
  }

  const rubrics = buildProficiencyRubrics(framework, now);

  return {
    '@context': 'https://purl.imsglobal.org/spec/case/v1p0/context/case_v1p0.jsonld',
    type: 'CFDocument',
    identifier: hashId(docUri),
    uri: docUri,
    CFPackageURI: `${docUri}/CFPackage`,
    creator: framework.publisher ?? 'Foxxi (Interego vertical)',
    title: framework.title,
    ...(framework.description ? { description: framework.description } : {}),
    lastChangeDateTime: now,
    CFItems: items,
    CFAssociations: associations,
    ...(rubrics.length > 0 ? { CFRubrics: rubrics } : {}),
  };
}

function buildProficiencyRubrics(framework: FoxxiSkillFramework, now: string): CaseRubric[] {
  const skillsWithLevels = framework.skills.filter(s => s.proficiencyLevel);
  if (skillsWithLevels.length === 0) return [];

  // One rubric per framework summarising the proficiency scale.
  const scale = ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Expert'] as const;
  const docUri = framework.id;
  const rubricUri = `${docUri}#rubric-proficiency`;
  return [{
    identifier: hashId(rubricUri),
    uri: rubricUri,
    title: 'RDCEO proficiency scale (IEEE 1484.20.2)',
    description: 'Five-level mastery rubric used to qualify competency assertions within this framework.',
    CFRubricCriteria: [{
      identifier: hashId(`${rubricUri}:level`),
      uri: `${rubricUri}/level`,
      category: 'proficiency',
      description: 'Demonstrated mastery of the competency.',
      CFRubricCriterionLevels: scale.map((name, i) => ({
        identifier: hashId(`${rubricUri}:level:${name}`),
        uri: `${rubricUri}/level/${name}`,
        quality: name,
        description: name,
        score: i + 1,
      })),
    }],
  }];
}

/**
 * Stable hash → CASE identifier (deterministic per input so re-export
 * doesn't churn the identifier across runs).
 */
function hashId(input: string): string {
  // Cheap stable hash. CASE only requires "an identifier" — not crypto-strong.
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return `case-${Math.abs(h).toString(36).padStart(8, '0')}`;
}
