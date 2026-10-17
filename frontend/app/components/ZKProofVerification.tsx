"use client";

import React from "react";
import { ZKProverPanel } from "@/src/components/zk-proof";
import type { ZkTask as ZkProofTask } from "@/src/lib/zk-proof";

export type ZkTask = ZkProofTask;

interface ZKProofVerificationProps {
  tasks: ZkTask[];
  walletConnected: boolean;
  walletAddress: string | null;
}

export default function ZKProofVerification({
  tasks,
  walletConnected,
  walletAddress,
}: ZKProofVerificationProps) {
  return (
    <ZKProverPanel
      tasks={tasks}
      walletConnected={walletConnected}
      walletAddress={walletAddress}
    />
  );
}
