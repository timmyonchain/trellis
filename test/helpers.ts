import hre from "hardhat";
import { ethers } from "hardhat";
import { FhevmType } from "@fhevm/mock-utils";
import type { Signer } from "ethers";

export async function encryptUint64(
  contractAddr: string,
  signer: Signer,
  value: bigint | number
): Promise<{ handle: Uint8Array; proof: Uint8Array }> {
  const input = hre.fhevm.createEncryptedInput(contractAddr, await signer.getAddress());
  input.add64(value);
  const enc = await input.encrypt();
  return { handle: enc.handles[0], proof: enc.inputProof };
}

export async function decryptUint64(
  handle: string | Uint8Array,
  contractAddr: string,
  signer: Signer
): Promise<bigint> {
  const handleHex = typeof handle === "string" ? handle : ethers.hexlify(handle);
  return hre.fhevm.userDecryptEuint(FhevmType.euint64, handleHex, contractAddr, signer);
}

export async function encryptAddress(
  contractAddr: string,
  signer: Signer,
  value: string
): Promise<{ handle: Uint8Array; proof: Uint8Array }> {
  const input = hre.fhevm.createEncryptedInput(contractAddr, await signer.getAddress());
  input.addAddress(value);
  const enc = await input.encrypt();
  return { handle: enc.handles[0], proof: enc.inputProof };
}

export async function decryptAddress(
  handle: string | Uint8Array,
  contractAddr: string,
  signer: Signer
): Promise<string> {
  const handleHex = typeof handle === "string" ? handle : ethers.hexlify(handle);
  return hre.fhevm.userDecryptEaddress(handleHex, contractAddr, signer);
}
