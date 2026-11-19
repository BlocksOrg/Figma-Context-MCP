import type {
  Component,
  ComponentProperty,
  ComponentPropertyDefinition,
  ComponentSet,
} from "@figma/rest-api-spec";

export interface SimplifiedPropertyDefinition {
  type: string;
  defaultValue: boolean | string;
}

export interface SimplifiedComponentDefinition {
  id: string;
  key: string;
  name: string;
  componentSetId?: string;
  propertyDefinitions?: Record<string, SimplifiedPropertyDefinition>;
}

export interface SimplifiedComponentSetDefinition {
  id: string;
  key: string;
  name: string;
  description?: string;
  propertyDefinitions?: Record<string, SimplifiedPropertyDefinition>;
}

/**
 * Strip the #nodeId suffix from Figma property names.
 * "On Sale#341:0" → "On Sale"
 */
export function stripPropertyNameSuffix(name: string): string {
  const hashIndex = name.indexOf("#");
  return hashIndex === -1 ? name : name.substring(0, hashIndex);
}

/**
 * Only BOOLEAN and TEXT properties carry a value an LLM can act on. VARIANT and
 * INSTANCE_SWAP values are component keys / variant names already visible on
 * the instance, and a SLOT value is a `SlotContentId` — an internal node guid
 * whose content is the instance's own children in the simplified tree — so
 * emitting it would spend tokens on something unresolvable. Narrowing on the
 * type (rather than on `typeof value`) is what keeps the guid object out of the
 * output: the spec types `value` / `defaultValue` as
 * `boolean | string | SlotContentId` across all kinds.
 */
function scalarValue(
  prop: ComponentProperty | ComponentPropertyDefinition,
): boolean | string | undefined {
  if (prop.type !== "BOOLEAN" && prop.type !== "TEXT") return undefined;
  const value = "value" in prop ? prop.value : prop.defaultValue;
  return typeof value === "boolean" || typeof value === "string" ? value : undefined;
}

/**
 * Simplify componentPropertyDefinitions from the raw Figma format to a flat
 * Record of property name → default value. Only BOOLEAN and TEXT properties
 * are kept (see `scalarValue`).
 */
export function simplifyPropertyDefinitions(
  definitions: Record<string, ComponentPropertyDefinition>,
): Record<string, SimplifiedPropertyDefinition> {
  const result: Record<string, SimplifiedPropertyDefinition> = {};
  for (const [name, def] of Object.entries(definitions)) {
    const defaultValue = scalarValue(def);
    if (defaultValue !== undefined) {
      result[stripPropertyNameSuffix(name)] = {
        type: def.type.toLowerCase(),
        defaultValue,
      };
    }
  }
  return result;
}

/**
 * Simplify componentPropertyReferences from the raw Figma format.
 * Strips #nodeId suffixes from property names and renames "characters" key to "text"
 * to match SimplifiedNode's text field.
 * Only handles "visible" (BOOLEAN) and "characters" (TEXT) references for Phase 1.
 */
export function simplifyPropertyReferences(
  references: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(references)) {
    if (key === "visible" || key === "characters") {
      const outputKey = key === "characters" ? "text" : key;
      result[outputKey] = stripPropertyNameSuffix(value);
    }
  }
  return result;
}

/**
 * Simplify instance componentProperties from the verbose Figma format to a flat
 * Record of property name → value. Only BOOLEAN and TEXT properties are kept
 * (see `scalarValue`).
 */
export function simplifyComponentProperties(
  properties: Record<string, ComponentProperty>,
): Record<string, boolean | string> {
  const result: Record<string, boolean | string> = {};
  for (const [name, prop] of Object.entries(properties)) {
    const value = scalarValue(prop);
    if (value !== undefined) {
      result[stripPropertyNameSuffix(name)] = value;
    }
  }
  return result;
}

/**
 * Remove unnecessary component properties and convert to simplified format.
 */
export function simplifyComponents(
  aggregatedComponents: Record<string, Component>,
  propertyDefinitions?: Record<string, Record<string, SimplifiedPropertyDefinition>>,
): Record<string, SimplifiedComponentDefinition> {
  return Object.fromEntries(
    Object.entries(aggregatedComponents).map(([id, comp]) => [
      id,
      {
        id,
        key: comp.key,
        name: comp.name,
        componentSetId: comp.componentSetId,
        ...(propertyDefinitions?.[id] && {
          propertyDefinitions: propertyDefinitions[id],
        }),
      },
    ]),
  );
}

/**
 * Remove unnecessary component set properties and convert to simplified format.
 */
export function simplifyComponentSets(
  aggregatedComponentSets: Record<string, ComponentSet>,
  propertyDefinitions?: Record<string, Record<string, SimplifiedPropertyDefinition>>,
): Record<string, SimplifiedComponentSetDefinition> {
  return Object.fromEntries(
    Object.entries(aggregatedComponentSets).map(([id, set]) => [
      id,
      {
        id,
        key: set.key,
        name: set.name,
        description: set.description,
        ...(propertyDefinitions?.[id] && {
          propertyDefinitions: propertyDefinitions[id],
        }),
      },
    ]),
  );
}
