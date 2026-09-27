/**
 * "1 person" / "3 people". Anything a customer reads — check results, alert
 * emails — should read as a sentence, not as "person(s)". These messages are
 * what an auditor samples and what goes in the product videos, so the grammar
 * is part of the product.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Pick the verb form to agree with a count: agree(1, "has", "have") → "has". */
export function agree(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}
