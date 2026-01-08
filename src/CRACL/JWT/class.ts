import { Bytes } from "bytecodec";
import { SigningAgent, VerificationAgent } from "zeyra";
import { Identifier, Role } from "../class";

export class JWT {
  private header = { alg: "ES256", typ: "JWT" };
  private payload: {
    iss: Identifier;
    sub: Identifier;
    rol: Role;
    iat: number;
    exp: number;
  };
  constructor(
    iss: Identifier,
    sub: Identifier,
    rol: Role,
    exp: number = Infinity
  ) {
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const expiresAtSeconds =
      exp >= 1e12
        ? Math.floor(exp / 1000) // epoch milliseconds to seconds
        : issuedAtSeconds + Math.max(0, Math.floor(exp)); // relative seconds

    this.payload = {
      iss,
      sub,
      rol,
      iat: issuedAtSeconds,
      exp: expiresAtSeconds,
    };
  }

  static async sign(privateJwk: JsonWebKey, jwt: JWT) {
    const signingAgent = new SigningAgent(privateJwk);
    const headerB64 = Bytes.toBase64UrlString(Bytes.fromJSON(jwt.header));
    const payloadB64 = Bytes.toBase64UrlString(Bytes.fromJSON(jwt.payload));
    const signingInput = `${headerB64}.${payloadB64}`;
    const signatureBytes = await signingAgent.sign(
      Bytes.fromString(signingInput)
    );
    const signatureB64 = Bytes.toBase64UrlString(signatureBytes);
    return `${signingInput}.${signatureB64}`;
  }

  static async verify(publicJwk: JsonWebKey, token: string) {
    try {
      const parts = String(token).split(".");
      if (parts.length !== 3) return false;

      const [headerB64, payloadB64, signatureB64] = parts;
      const header = Bytes.toJSON(Bytes.fromBase64UrlString(headerB64));
      const payload = Bytes.toJSON(Bytes.fromBase64UrlString(payloadB64));
      if (!header.kid || header.alg !== "ES256" || header.typ !== "JWT")
        return false;
      if (typeof payload.iss !== "string" || typeof payload.sub !== "string")
        return false;

      const nowSeconds = Math.floor(Date.now() / 1000);
      if (typeof payload.exp !== "number" || nowSeconds >= payload.exp)
        return false;

      const verifier = new VerificationAgent(publicJwk);
      const signingInput = Bytes.fromString(`${headerB64}.${payloadB64}`);
      const signature = Bytes.fromBase64UrlString(signatureB64);
      const ok = await verifier.verify(signingInput, signature.buffer);
      return ok ? payload.sub : false;
    } catch {
      return false;
    }
  }
}
