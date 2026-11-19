import type { ComponentProperty, ComponentPropertyDefinition } from "@figma/rest-api-spec";
import { describe, expect, it } from "vitest";
import {
  simplifyComponentProperties,
  simplifyPropertyDefinitions,
} from "~/transformers/component.js";

// @figma/rest-api-spec 0.47 added the SLOT property kind, whose value is a
// SlotContentId object rather than a scalar. The simplified output must stay
// a flat name -> boolean | string map.
const slotContent = { guid: { sessionID: 1, localID: 2 } };

describe("component properties with SLOT kind", () => {
  it("keeps BOOLEAN/TEXT instance values and drops SLOT without leaking the guid", () => {
    const properties: Record<string, ComponentProperty> = {
      "Show icon#1:0": { type: "BOOLEAN", value: true },
      "Label#1:1": { type: "TEXT", value: "Buy" },
      "Content#1:2": { type: "SLOT", value: slotContent },
      Size: { type: "VARIANT", value: "Large" },
    };

    expect(simplifyComponentProperties(properties)).toEqual({
      "Show icon": true,
      Label: "Buy",
    });
  });

  it("drops SLOT property definitions the same way", () => {
    const definitions: Record<string, ComponentPropertyDefinition> = {
      "Label#1:1": { type: "TEXT", defaultValue: "Buy" },
      "Content#1:2": { type: "SLOT", defaultValue: slotContent },
    };

    expect(simplifyPropertyDefinitions(definitions)).toEqual({
      Label: { type: "text", defaultValue: "Buy" },
    });
  });
});
