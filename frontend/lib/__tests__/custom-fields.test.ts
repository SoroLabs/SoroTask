import {
  coerceForField,
  formatFieldValue,
  initialValuesFromDefinitions,
  sanitizeValues,
  validateValues,
  type CustomFieldDefinition,
} from '@/lib/custom-fields';

const definitions: CustomFieldDefinition[] = [
  { id: 'f1', key: 'team', label: 'Team', type: 'text', required: true },
  { id: 'f2', key: 'priority', label: 'Priority', type: 'select', required: true, options: ['low', 'medium', 'high'] },
  { id: 'f3', key: 'budget', label: 'Budget', type: 'number' },
  { id: 'f4', key: 'compliance', label: 'Compliance Required', type: 'checkbox' },
  { id: 'f5', key: 'deadline', label: 'Deadline', type: 'date' },
  { id: 'f6', key: 'legacyTag', label: 'Legacy Tag', type: 'text', retired: true },
];

describe('custom-fields utilities', () => {
  it('coerces representative values for each field type', () => {
    expect(coerceForField(definitions[0], 42)).toBe('42');
    expect(coerceForField(definitions[1], 'high')).toBe('high');
    expect(coerceForField(definitions[2], '15.5')).toBe(15.5);
    expect(coerceForField(definitions[3], 'true')).toBe(true);
    expect(coerceForField(definitions[4], '2026-04-27')).toBe('2026-04-27');
  });

  it('validates required and invalid values safely', () => {
    const result = validateValues(definitions, {
      team: '',
      priority: 'urgent',
      budget: 'bad' as unknown as number,
      compliance: 'yes' as unknown as boolean,
      deadline: '04/27/2026',
    });

    expect(result.isValid).toBe(false);
    expect(result.errors.team).toContain('required');
    expect(result.errors.priority).toContain('invalid selection');
    expect(result.errors.budget).toContain('valid number');
    expect(result.errors.compliance).toContain('true or false');
    expect(result.errors.deadline).toContain('valid date');
  });

  it('builds default initial values for active fields only', () => {
    const initial = initialValuesFromDefinitions(definitions);

    expect(initial.team).toBe('');
    expect(initial.priority).toBe('');
    expect(initial.budget).toBe('');
    expect(initial.compliance).toBe(false);
    expect(initial.deadline).toBe('');
    expect(initial.legacyTag).toBeUndefined();
  });

  it('formats missing definitions and retired select options gracefully', () => {
    const priorityDef = definitions[1];

    expect(formatFieldValue(undefined, 'legacy-value')).toContain('field definition removed');
    expect(formatFieldValue(priorityDef, 'archived')).toContain('option retired');
  });

  it('sanitizes values when schema changes occur', () => {
    const raw = {
      team: 'Core',
      priority: 'medium',
      budget: '1000',
      compliance: 'false',
      deadline: '2026-05-01',
      removedField: 99,
    };

    const sanitized = sanitizeValues(definitions, raw);

    expect(sanitized.team).toBe('Core');
    expect(sanitized.priority).toBe('medium');
    expect(sanitized.budget).toBe(1000);
    expect(sanitized.compliance).toBe(false);
    expect(sanitized.deadline).toBe('2026-05-01');
    expect(sanitized.removedField).toBe(99);
  });
});
