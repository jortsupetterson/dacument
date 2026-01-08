//DistributedAccessControlledDocument

export class Dacument {
  /** write once immutable */
  private static actor: string | null = null;
  /** Sets the actor if it is not already set for the session */
  public static setActor(actorId: string): void {
    if (this.actor) return;
    this.actor = actorId;
  }

  constructor(config: {
    schema: {};
    onGrantsRevoked: () => {};
    snapshot?: {};
  }) {
    if (!Dacument.actor)
      throw new Error(
        "{dacument} static actor must be set before creating instances"
      );
  }
}
