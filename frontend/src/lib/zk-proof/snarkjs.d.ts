declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
      logger?: { debug: (message: string) => void },
    ): Promise<{
      proof: Record<string, unknown> & {
        pi_a: Array<string | number>;
        pi_b: Array<Array<string | number>>;
        pi_c: Array<string | number>;
      };
      publicSignals: Array<string | number>;
    }>;
    verify(
      verificationKey: Record<string, unknown>,
      publicSignals: Array<string | number>,
      proof: Record<string, unknown>,
    ): Promise<boolean>;
  };
}
