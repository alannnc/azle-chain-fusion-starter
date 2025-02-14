import {
  None,
  Opt,
  Record,
  Some,
  StableBTreeMap,
  ThresholdKeyInfo,
  ecdsaPublicKey,
  nat,
  nat8,
  text,
} from "azle";
import { computeAddress, hexlify } from "ethers";

export type EcdsaKeyIdName = "dfx_test_key" | "test_key_1" | "key_1";
export type EcdsaKeyIdCurve = "secp256k1";

export type EcdsaKeyId = {
  curve: EcdsaKeyIdCurve;
  name: EcdsaKeyIdName;
};

const AppConfig = Record({
  ecdsaKeyId: Opt(
    Record({
      name: text,
      curve: text,
    })
  ),
  evmAddress: Opt(text),
  nonce: nat,
});
type AppConfig = typeof AppConfig.tsType;

export type InitOptions = {
  ecdsaKeyId: EcdsaKeyId;
};

export class ConfigService {
  private configStore = StableBTreeMap<nat8, typeof AppConfig.tsType>(0);
  private config: AppConfig;

  constructor() {
    let appConfig = this.configStore.get(0).Some;

    if (appConfig === undefined) {
      const newConfig = {
        ecdsaKeyId: None,
        evmAddress: None,
        nonce: 0n,
      };

      this.configStore.insert(0, newConfig);

      appConfig = newConfig;
    }

    this.config = appConfig;
  }

  public async init(options: InitOptions) {
    this.setEcdsaKeyId(options.ecdsaKeyId.name, options.ecdsaKeyId.curve);
    await this.setEvmAddress(this.getKeyId());
  }

  private setEcdsaKeyId(name: EcdsaKeyIdName, curve: EcdsaKeyIdCurve): void {
    const ecdsaKeyId = {
      name,
      curve,
    };

    this.config = {
      ...this.config,
      ecdsaKeyId: Some(ecdsaKeyId),
    };

    this.configStore.insert(0, this.config);
  }

  public getKeyId(): EcdsaKeyId {
    const storedKeyId = this.config.ecdsaKeyId.Some;

    if (storedKeyId === undefined) {
      throw new Error("Key ID not set");
    }

    const keyId = {
      name: storedKeyId.name,
      curve: storedKeyId.curve,
    } as EcdsaKeyId;

    return keyId;
  }

  private async setEvmAddress(keyId: EcdsaKeyId): Promise<void> {
    const thresholdKeyInfo: ThresholdKeyInfo = {
      derivationPath: [],
      keyId: {
        name: keyId.name,
        curve: keyId.curve,
      } as EcdsaKeyId,
    };

    const pubkey = await ecdsaPublicKey(thresholdKeyInfo);
    const evmAddress = computeAddress(hexlify(pubkey));

    this.config = {
      ...this.config,
      evmAddress: Some(evmAddress),
    };

    this.configStore.insert(0, this.config);
  }

  public getEvmAddres(): string {
    const address = this.config.evmAddress.Some;

    if (address === undefined) {
      throw new Error("EVM address not set");
    }

    return address;
  }

  public getNonce(): nat {
    return this.config.nonce;
  }

  public incrementNonce(): void {
    this.config = {
      ...this.config,
      nonce: this.config.nonce + 1n,
    };

    this.configStore.insert(0, this.config);
  }
}
