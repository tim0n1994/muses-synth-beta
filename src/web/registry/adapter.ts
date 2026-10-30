import type { DashboardConfigInput, DashboardSectionInput } from "./types";

/**
 * Temporary M2 integration seam.
 * Replace this local envelope with the shared server settings DTO once M2 publishes it.
 * The adapter intentionally copies only the known dashboard fields; extra server fields
 * are not forwarded into rendering.
 */
export interface M2DashboardEnvelopeV1 {
  readonly schemaVersion: string;
  readonly id: string;
  readonly title?: string;
  readonly blocks: readonly M2DashboardBlockV1[];
}

export interface M2DashboardBlockV1 {
  readonly id: string;
  readonly componentType: string;
  readonly componentSchemaVersion: string;
  readonly props: unknown;
  readonly layout: DashboardSectionInput["layout"];
}

export function adaptM2DashboardEnvelope(
  envelope: M2DashboardEnvelopeV1,
): DashboardConfigInput {
  return {
    schemaVersion: envelope.schemaVersion,
    dashboardId: envelope.id,
    ...(envelope.title === undefined ? {} : { title: envelope.title }),
    sections: envelope.blocks.map((block) => ({
      id: block.id,
      type: block.componentType,
      schemaVersion: block.componentSchemaVersion,
      props: block.props,
      layout: block.layout,
    })),
  };
}
