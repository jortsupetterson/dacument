export type RGAIndex = `${string}#${number}`;
export type RGAEntry = {
  after: RGAIndex;
  active: boolean;
  character: string;
};
export type RGASnapshot = Record<RGAIndex, RGAEntry>;
