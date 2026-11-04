export function thirdPartyLicenses(): {
  name: string;
  apply: "build";
  generateBundle(): Promise<void>;
};
